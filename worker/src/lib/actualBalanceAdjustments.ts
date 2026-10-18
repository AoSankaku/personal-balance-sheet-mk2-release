/**
 * Recompute every checkpoint-owned reconciliation entry.
 *
 * Callers append these statements to the same D1 batch as the journal or
 * snapshot mutation that changed the ledger. Amounts are stored in the same
 * currency-scaled integer units as journal_lines and actual_balance_entries.
 */
export function buildActualBalanceAdjustmentRefreshStatements(
  DB: D1Database,
): D1PreparedStatement[] {
  const scaleFactor = (scale: string) =>
    `CASE (${scale})
      WHEN 0 THEN 1
      WHEN 1 THEN 10
      WHEN 2 THEN 100
      WHEN 3 THEN 1000
      WHEN 4 THEN 10000
      WHEN 5 THEN 100000
      WHEN 6 THEN 1000000
      WHEN 7 THEN 10000000
      WHEN 8 THEN 100000000
      WHEN 9 THEN 1000000000
      ELSE 1
    END`;

  const checkpointCtes = `
    WITH linked AS (
      SELECT
        adjustment.actual_balance_entry_id,
        adjustment.journal_entry_id,
        adjustment.is_resolved,
        entry.account_id,
        entry.currency,
        entry.amount AS stored_target_amount,
        entry.money_scale AS entry_money_scale,
        adjustment.default_money_scale,
        enabled_currency.decimal_places AS configured_scale,
        snapshot.id AS snapshot_id,
        snapshot.snapshot_date,
        snapshot.snapshot_time,
        account.type AS account_type
      FROM actual_balance_adjustments AS adjustment
      JOIN actual_balance_entries AS entry
        ON entry.id = adjustment.actual_balance_entry_id
      JOIN actual_balance_snapshots AS snapshot
        ON snapshot.id = entry.snapshot_id
      JOIN accounts AS account ON account.id = entry.account_id
      LEFT JOIN enabled_currencies AS enabled_currency
        ON enabled_currency.code = entry.currency
    ),
    scaled AS (
      SELECT
        linked.*,
        COALESCE(
          linked.entry_money_scale,
          linked.default_money_scale,
          linked.configured_scale,
          0
        ) AS source_scale,
        COALESCE(
          linked.configured_scale,
          linked.default_money_scale,
          linked.entry_money_scale,
          0
        ) AS target_scale
      FROM linked
    ),
    rescaled AS (
      SELECT
        scaled.*,
        CASE
          WHEN scaled.target_scale >= scaled.source_scale THEN
            scaled.stored_target_amount * ${scaleFactor("scaled.target_scale - scaled.source_scale")}
          ELSE CAST(
            scaled.stored_target_amount / ${scaleFactor("scaled.source_scale - scaled.target_scale")}
            AS INTEGER
          )
        END AS target_amount
      FROM scaled
    ),
    ranked AS (
      SELECT
        rescaled.*,
        ROW_NUMBER() OVER (
          PARTITION BY rescaled.account_id, rescaled.currency, rescaled.snapshot_date
          ORDER BY
            rescaled.snapshot_time DESC,
            rescaled.snapshot_id DESC,
            rescaled.actual_balance_entry_id DESC
        ) AS same_day_rank
      FROM rescaled
    ),
    active AS (
      SELECT * FROM ranked WHERE same_day_rank = 1
    ),
    residuals AS (
      SELECT
        active.*,
        (CASE WHEN active.account_type = 'liability'
          THEN -active.target_amount ELSE active.target_amount END)
        - COALESCE((
          SELECT SUM(line.debit - line.credit)
          FROM journal_lines AS line
          JOIN journal_entries AS journal
            ON journal.id = line.journal_entry_id
          WHERE line.account_id = active.account_id
            AND line.currency = active.currency
            AND journal.date <= active.snapshot_date
            AND NOT EXISTS (
              SELECT 1 FROM actual_balance_adjustments AS owned
              WHERE owned.journal_entry_id = journal.id
            )
        ), 0) AS residual
      FROM active
    ),
    active_deltas AS (
      SELECT
        residuals.actual_balance_entry_id,
        residuals.journal_entry_id,
        residuals.account_id,
        residuals.currency,
        residuals.snapshot_date,
        residuals.is_resolved,
        residuals.residual - LAG(residuals.residual, 1, 0) OVER (
          PARTITION BY residuals.account_id, residuals.currency
          ORDER BY residuals.snapshot_date
        ) AS amount
      FROM residuals
    ),
    all_deltas AS (
      SELECT
        ranked.actual_balance_entry_id,
        ranked.journal_entry_id,
        ranked.account_id,
        ranked.currency,
        ranked.snapshot_date,
        ranked.is_resolved,
        COALESCE(active_deltas.amount, 0) AS amount
      FROM ranked
      LEFT JOIN active_deltas
        ON active_deltas.actual_balance_entry_id = ranked.actual_balance_entry_id
    )
  `;

  const updateAmounts = DB.prepare(`
    ${checkpointCtes}
    UPDATE actual_balance_adjustments AS adjustment
    SET amount = COALESCE((
      SELECT all_deltas.amount FROM all_deltas
      WHERE all_deltas.actual_balance_entry_id = adjustment.actual_balance_entry_id
    ), 0)
  `);

  // Force the batch to fail before any derived rows can be truncated or
  // overflowed when a currency's configured precision has changed.
  const rejectUnrepresentableTargets = DB.prepare(`
    ${checkpointCtes}
    UPDATE actual_balance_adjustments
    SET amount = NULL
    WHERE actual_balance_entry_id IN (
      SELECT ranked.actual_balance_entry_id
      FROM ranked
      WHERE (
        ranked.target_scale < ranked.source_scale
        AND ranked.stored_target_amount % ${scaleFactor("ranked.source_scale - ranked.target_scale")} != 0
      ) OR (
        ranked.target_scale >= ranked.source_scale
        AND (
          ranked.stored_target_amount > ${Number.MAX_SAFE_INTEGER} / ${scaleFactor("ranked.target_scale - ranked.source_scale")}
          OR ranked.stored_target_amount < -${Number.MAX_SAFE_INTEGER} / ${scaleFactor("ranked.target_scale - ranked.source_scale")}
        )
      ) OR (
        ranked.target_scale < ranked.source_scale
        AND (
          ranked.stored_target_amount / ${scaleFactor("ranked.source_scale - ranked.target_scale")} > ${Number.MAX_SAFE_INTEGER}
          OR ranked.stored_target_amount / ${scaleFactor("ranked.source_scale - ranked.target_scale")} < -${Number.MAX_SAFE_INTEGER}
        )
      )
    )
  `);

  const updateDates = DB.prepare(`
    ${checkpointCtes}
    UPDATE journal_entries AS journal
    SET date = (
      SELECT all_deltas.snapshot_date FROM all_deltas
      WHERE all_deltas.journal_entry_id = journal.id
    )
    WHERE journal.id IN (SELECT journal_entry_id FROM all_deltas)
  `);

  const updateLines = DB.prepare(`
    ${checkpointCtes}
    UPDATE journal_lines AS line
    SET
      account_id = CASE
        WHEN line.account_id = all_deltas.account_id THEN line.account_id
        WHEN all_deltas.is_resolved = 0 THEN (
          SELECT id FROM accounts WHERE name = '__system:unknown_funds__' LIMIT 1
        )
        WHEN all_deltas.amount < 0 THEN (
          SELECT id FROM accounts WHERE name = '__system:misc_expense__' LIMIT 1
        )
        ELSE (
          SELECT id FROM accounts WHERE name = '__system:misc_income__' LIMIT 1
        )
      END,
      debit = CASE
        WHEN line.account_id = all_deltas.account_id
          THEN CASE WHEN all_deltas.amount > 0 THEN all_deltas.amount ELSE 0 END
        ELSE CASE WHEN all_deltas.amount < 0 THEN -all_deltas.amount ELSE 0 END
      END,
      credit = CASE
        WHEN line.account_id = all_deltas.account_id
          THEN CASE WHEN all_deltas.amount < 0 THEN -all_deltas.amount ELSE 0 END
        ELSE CASE WHEN all_deltas.amount > 0 THEN all_deltas.amount ELSE 0 END
      END
    FROM all_deltas
    WHERE line.journal_entry_id = all_deltas.journal_entry_id
  `);

  return [rejectUnrepresentableTargets, updateAmounts, updateDates, updateLines];
}
