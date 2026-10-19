import { afterEach, describe, expect, test } from "bun:test";
import type { DepreciationBudgetSettings } from "../../shared/depreciationBudget";
import { depreciationRouter } from "../src/routes/depreciation";
import { toLocalDateString } from "../src/lib/appDate";
import { createTestD1 } from "./helpers/d1";

function makeHarness(options?: {maxParameters?:number}) {
  const harness = createTestD1(options);
  const assetId = harness.sqlite
    .query(
      "INSERT INTO accounts (name, type, category) VALUES ('Laptop', 'asset', 'property') RETURNING id",
    )
    .get<{ id: number }>()!.id;
  const cashId = harness.sqlite
    .query(
      "INSERT INTO accounts (name, type, category) VALUES ('Cash', 'asset', 'cash') RETURNING id",
    )
    .get<{ id: number }>()!.id;
  const expenseId = harness.sqlite
    .query(
      "INSERT INTO accounts (name, type, category) VALUES ('Depreciation', 'expense', 'utilities') RETURNING id",
    )
    .get<{ id: number }>()!.id;
  const purchaseJournalId = harness.sqlite
    .query(
      "INSERT INTO journal_entries (date, description, created_at) VALUES ('2026-01-01', 'Laptop purchase', '2026-01-01 09:00:00') RETURNING id",
    )
    .get<{ id: number }>()!.id;
  harness.sqlite
    .query(
      "INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit, currency) VALUES (?, ?, 300000, 0, 'JPY'), (?, ?, 0, 300000, 'JPY')",
    )
    .run(purchaseJournalId, assetId, purchaseJournalId, cashId);
  const scheduleId = harness.sqlite
    .query(
      "INSERT INTO depreciation_schedules (source_journal_entry_id, asset_account_id, expense_account_id, total_amount, months, start_date, description) VALUES (?, ?, ?, 300000, 30, '2026-01-01', 'Laptop') RETURNING id",
    )
    .get<{ id: number }>(purchaseJournalId, assetId, expenseId)!.id;
  const purchaseCategoryId = harness.sqlite
    .query(
      "INSERT INTO budget_categories (name, budget_group) VALUES ('Laptop reserve', 'savings') RETURNING id",
    )
    .get<{ id: number }>()!.id;
  const sourceCategoryId = harness.sqlite
    .query(
      "INSERT INTO budget_categories (name, budget_group) VALUES ('Living costs', 'daily') RETURNING id",
    )
    .get<{ id: number }>()!.id;

  return {
    ...harness,
    env: { DB: harness.DB },
    scheduleId,
    assetId,
    expenseId,
    purchaseJournalId,
    purchaseCategoryId,
    sourceCategoryId,
    cashId,
  };
}

function seedDepreciationEntry(
  harness: ReturnType<typeof makeHarness>,
  monthNumber = 1,
  amount = 10000,
  date = `2026-${String(monthNumber).padStart(2, "0")}-01`,
) {
  const journalId = harness.sqlite.query(`INSERT INTO journal_entries(date,description,created_at)
    VALUES(?, 'Existing depreciation month', ?) RETURNING id`).get<{ id: number }>(date, `${date} 10:00:00`)!.id;
  harness.sqlite.query(`INSERT INTO depreciation_entries(schedule_id,journal_entry_id,month_number) VALUES(?,?,?)`)
    .run(harness.scheduleId, journalId, monthNumber);
  harness.sqlite.query(`INSERT INTO journal_lines(journal_entry_id,account_id,debit,credit,currency)
    VALUES(?,?,?,0,'JPY'),(?,?,0,?,'JPY')`).run(
      journalId, harness.expenseId, amount, journalId, harness.assetId, amount,
    );
  return journalId;
}

async function postJson(
  harness: ReturnType<typeof makeHarness>,
  path: string,
  body: unknown,
) {
  return depreciationRouter.request(
    path,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
    harness.env,
  );
}

describe("depreciation budget configuration and repair API", () => {
  const harnesses: ReturnType<typeof makeHarness>[] = [];
  afterEach(() => {
    for (const harness of harnesses.splice(0)) harness.close();
  });

  test("previews assigned, special, and unallocated purchase handling without changing journals", async () => {
    const harness = makeHarness();
    harnesses.push(harness);
    const journalCountBefore = harness.sqlite
      .query("SELECT COUNT(*) AS count FROM journal_entries")
      .get<{ count: number }>()!.count;

    const settings: DepreciationBudgetSettings[] = [
      {
        method: "assigned",
        purchase_category_id: harness.purchaseCategoryId,
        monthly_source_category_id: harness.sourceCategoryId,
      },
      { method: "special", monthly_source_category_id: harness.sourceCategoryId },
      { method: "unallocated", confirm_unallocated: true },
    ];

    for (const budgetSettings of settings) {
      const response = await postJson(
        harness,
        `/${harness.scheduleId}/budget/preview`,
        { settings: budgetSettings },
      );
      expect(response.status).toBe(200);
      const preview = (await response.json()) as {
        progress: { target_amount: number; method: string | null };
        changes: unknown[];
        can_apply: boolean;
      };
      expect(preview.progress).toMatchObject({
        target_amount: 300000,
        method: budgetSettings.method,
      });
      expect(Array.isArray(preview.changes)).toBe(true);
      expect(preview.can_apply).toBe(true);
    }

    expect(
      harness.sqlite
        .query("SELECT COUNT(*) AS count FROM journal_entries")
        .get<{ count: number }>()!.count,
    ).toBe(journalCountBefore);
  });

  test("requires explicit confirmation before applying an unallocated plan", async () => {
    const harness = makeHarness();
    harnesses.push(harness);
    const previewResponse = await postJson(
      harness,
      `/${harness.scheduleId}/budget/preview`,
      { settings: { method: "unallocated", confirm_unallocated: true } },
    );
    expect(previewResponse.status).toBe(200);
    const preview = (await previewResponse.json()) as {
      token: string;
      settings: DepreciationBudgetSettings;
    };

    const response = await postJson(harness, `/${harness.scheduleId}/budget/apply`, {
      token: preview.token,
      settings: preview.settings,
      confirmed: false,
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "confirmation_required" });
  });

  test("rejects a stale preview after source purchase data changes", async () => {
    const harness = makeHarness();
    harnesses.push(harness);
    const previewResponse = await postJson(
      harness,
      `/${harness.scheduleId}/budget/preview`,
      {
        settings: {
          method: "assigned",
          purchase_category_id: harness.purchaseCategoryId,
          monthly_source_category_id: harness.sourceCategoryId,
        },
      },
    );
    expect(previewResponse.status).toBe(200);
    const preview = (await previewResponse.json()) as {
      token: string;
      settings: DepreciationBudgetSettings;
    };
    harness.sqlite
      .query("UPDATE journal_lines SET debit = 290000 WHERE journal_entry_id = ? AND debit > 0")
      .run(harness.purchaseJournalId);

    const response = await postJson(harness, `/${harness.scheduleId}/budget/apply`, {
      token: preview.token,
      settings: preview.settings,
      confirmed: true,
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "stale_preview" });
  });

  test("applies owned purchase and monthly transfers atomically and replays the same token", async () => {
    const harness = makeHarness();
    harnesses.push(harness);
    seedDepreciationEntry(harness);
    const settings: DepreciationBudgetSettings = {
      method: "assigned",
      purchase_category_id: harness.purchaseCategoryId,
      monthly_source_category_id: harness.sourceCategoryId,
    };
    const previewResponse = await postJson(harness, `/${harness.scheduleId}/budget/preview`, { settings });
    expect(previewResponse.status).toBe(200);
    const preview = await previewResponse.json() as { token: string; settings: DepreciationBudgetSettings };
    const input = { token: preview.token, settings: preview.settings, confirmed: true };
    const first = await postJson(harness, `/${harness.scheduleId}/budget/apply`, input);
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ budget: { method: "assigned", target_amount: 300000 } });
    expect(harness.sqlite.query("SELECT COUNT(*) AS n FROM budget_adjustment_logs WHERE depreciation_schedule_id=? AND depreciation_event_key='purchase:1'").get<{ n: number }>(harness.scheduleId)?.n).toBe(1);
    expect(harness.sqlite.query("SELECT COUNT(*) AS n FROM budget_adjustment_logs WHERE depreciation_schedule_id=? AND depreciation_event_key LIKE 'monthly:%'").get<{ n: number }>(harness.scheduleId)?.n).toBeGreaterThan(0);
    const second = await postJson(harness, `/${harness.scheduleId}/budget/apply`, input);
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ replayed: true });
    expect(harness.sqlite.query("SELECT COUNT(*) AS n FROM depreciation_budget_revisions WHERE schedule_id=?").get<{ n: number }>(harness.scheduleId)?.n).toBe(1);
  });

  test("keeps the unreceipted principal when accounting months are missing", async () => {
    const harness = makeHarness();
    harnesses.push(harness);
    const settings: DepreciationBudgetSettings = {
      method: "assigned", purchase_category_id: harness.purchaseCategoryId,
      monthly_source_category_id: harness.sourceCategoryId,
    };
    const previewResponse = await postJson(harness, `/${harness.scheduleId}/budget/preview`, { settings });
    expect(previewResponse.status).toBe(200);
    const preview = await previewResponse.json() as {
      progress: { reimbursed_amount: number; remaining_amount: number; future_amount: number };
      changes: { event: { kind: string } }[];
    };
    expect(preview.progress).toMatchObject({
      reimbursed_amount: 0, remaining_amount: 300000, future_amount: 0,
    });
    expect(preview.changes.some((change) => change.event.kind === "monthly")).toBe(false);
  });

  test("orders settlements against existing receipts and preserves a residual plus future receipt", async () => {
    const harness = makeHarness();
    harnesses.push(harness);
    seedDepreciationEntry(harness, 11, 10000, "2026-11-01");
    const settings: DepreciationBudgetSettings = {
      method: "assigned", purchase_category_id: harness.purchaseCategoryId,
      monthly_source_category_id: harness.sourceCategoryId,
      settlements: [{ key: "partial", date: toLocalDateString(), amount: 299991, source_category_id: null }],
    };
    const previewResponse = await postJson(harness, `/${harness.scheduleId}/budget/preview`, { settings });
    expect(previewResponse.status).toBe(200);
    const preview = await previewResponse.json() as {
      token: string; settings: DepreciationBudgetSettings;
      progress: { reimbursed_amount: number; remaining_amount: number; future_amount: number };
    };
    expect(preview.progress).toMatchObject({ reimbursed_amount: 299991, remaining_amount: 9, future_amount: 9 });
    const applied = await postJson(harness, `/${harness.scheduleId}/budget/apply`, {
      token: preview.token, settings: preview.settings, confirmed: true,
    });
    expect(applied.status).toBe(200);
    expect(harness.sqlite.query(`SELECT SUM(amount) AS total FROM budget_adjustment_logs
      WHERE depreciation_schedule_id=? AND depreciation_event_side='destination'
      AND (depreciation_event_key LIKE 'monthly:%' OR depreciation_event_key LIKE 'settlement:%')`)
      .get<{ total: number }>(harness.scheduleId)?.total).toBe(300000);
  });

  test("rejects a settlement larger than the still-unreimbursed principal", async () => {
    const harness = makeHarness();
    harnesses.push(harness);
    const response = await postJson(harness, `/${harness.scheduleId}/budget/preview`, {
      settings: {
        method: "assigned", purchase_category_id: harness.purchaseCategoryId,
        monthly_source_category_id: harness.sourceCategoryId,
        settlements: [{ key: "over", date: toLocalDateString(), amount: 300001, source_category_id: null }],
      },
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "settlement_exceeds_remaining_principal" });
  });

  test("special carry repairs the corrected negative balance, not the stored legacy reset amount", async () => {
    const harness = makeHarness();
    harnesses.push(harness);
    seedDepreciationEntry(harness, 1, 10000, "2026-01-01");
    seedDepreciationEntry(harness, 2, 10000, "2026-02-01");
    seedDepreciationEntry(harness, 3, 10000, "2026-03-01");
    const specialId = harness.sqlite.query("INSERT INTO budget_categories(name,budget_group) VALUES('Depreciation debt','depreciation') RETURNING id")
      .get<{ id: number }>()!.id;
    harness.sqlite.query("UPDATE depreciation_schedules SET budget_special_category_id=? WHERE id=?")
      .run(specialId, harness.scheduleId);
    const reset = harness.sqlite.query(`INSERT INTO budget_adjustment_logs
      (budget_category_id,year_month,amount,currency,date,adjustment_type,created_at,reset_scope)
      VALUES(?,'2026-04',123,'JPY','2026-04-01','reset','2026-04-01 12:00:00','category') RETURNING id`)
      .get<{ id: number }>(specialId)!;
    const settings: DepreciationBudgetSettings = {
      method: "special", monthly_source_category_id: harness.sourceCategoryId,
      reset_decisions: [{ reset_log_id: reset.id, action: "carry", scope: "category" }],
    };
    const response = await postJson(harness, `/${harness.scheduleId}/budget/preview`, { settings });
    expect(response.status).toBe(200);
    const preview = await response.json() as {
      changes: { operation: string; event: { kind: string; amount: number; date: string } }[];
    };
    expect(preview.changes).toContainEqual(expect.objectContaining({
      operation: "add",
      event: expect.objectContaining({ kind: "carry", amount: 270000, date: "2026-04-01" }),
    }));
  });

  test("counts a paired special settlement at its reset boundary as the final receipt", async () => {
    const harness = makeHarness();
    harnesses.push(harness);
    seedDepreciationEntry(harness, 1, 10000, "2026-01-01");
    seedDepreciationEntry(harness, 2, 10000, "2026-02-01");
    seedDepreciationEntry(harness, 3, 10000, "2026-03-01");
    const specialId = harness.sqlite.query("INSERT INTO budget_categories(name,budget_group) VALUES('Depreciation debt','depreciation') RETURNING id")
      .get<{ id: number }>()!.id;
    harness.sqlite.query("UPDATE depreciation_schedules SET budget_special_category_id=? WHERE id=?")
      .run(specialId, harness.scheduleId);
    const reset = harness.sqlite.query(`INSERT INTO budget_adjustment_logs
      (budget_category_id,year_month,amount,currency,date,adjustment_type,created_at,reset_scope)
      VALUES(?,'2026-04',0,'JPY','2026-04-01','reset','2026-04-01 12:00:00','category') RETURNING id`)
      .get<{ id: number }>(specialId)!;
    const settings: DepreciationBudgetSettings = {
      method: "special", monthly_source_category_id: harness.sourceCategoryId,
      reset_decisions: [{ reset_log_id: reset.id, action: "settle", settlement_source_category_id: harness.sourceCategoryId }],
    };
    const previewResponse = await postJson(harness, `/${harness.scheduleId}/budget/preview`, { settings });
    expect(previewResponse.status).toBe(200);
    const preview = await previewResponse.json() as { token: string; settings: DepreciationBudgetSettings };
    const applied = await postJson(harness, `/${harness.scheduleId}/budget/apply`, {
      token: preview.token, settings: preview.settings, confirmed: true,
    });
    expect(applied.status).toBe(200);
    const list = await depreciationRouter.request("/", {}, harness.env);
    const schedules = await list.json() as { id: number; budget: { reimbursed_amount: number; remaining_amount: number; status: string } }[];
    expect(schedules.find((row) => row.id === harness.scheduleId)?.budget)
      .toMatchObject({ reimbursed_amount: 300000, remaining_amount: 0, status: "completed" });
    expect(harness.sqlite.query(`SELECT SUM(amount) AS total FROM budget_adjustment_logs
      WHERE depreciation_schedule_id=? AND depreciation_event_key='settlement:reset:${reset.id}'
      AND depreciation_event_side='destination'`).get<{ total: number }>(harness.scheduleId)?.total).toBe(270000);
  });

  test("creates configured depreciation entries, budget logs, and idempotency record in one request", async () => {
    const harness = makeHarness();
    harnesses.push(harness);
    const input = {
      purchase_date: "2026-10-01",
      description: "Camera",
      asset_account_id: harness.assetId,
      payment_account_id: harness.cashId,
      expense_account_id: harness.expenseId,
      total_amount: 300000,
      months: 30,
      currency: "JPY",
      budget_settings: {
        method: "assigned",
        purchase_category_id: harness.purchaseCategoryId,
        monthly_source_category_id: harness.sourceCategoryId,
      },
      idempotency_key: "camera-create-key",
    };
    const first = await depreciationRouter.request("/", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input),
    }, harness.env);
    expect(first.status).toBe(201);
    const created = await first.json() as { schedule_id: number; source_journal_entry_id: number };
    expect(harness.sqlite.query("SELECT budget_method,budget_target_amount,budget_idempotency_key FROM depreciation_schedules WHERE id=?")
      .get(created.schedule_id)).toEqual({ budget_method: "assigned", budget_target_amount: 300000, budget_idempotency_key: "camera-create-key" });
    expect(harness.sqlite.query("SELECT COUNT(*) AS n FROM depreciation_budget_reservations WHERE schedule_id=?")
      .get<{ n: number }>(created.schedule_id)?.n).toBe(0);
    expect(harness.sqlite.query("SELECT amount FROM budget_adjustment_logs WHERE depreciation_schedule_id=? AND depreciation_event_key='purchase:camera-create-key'")
      .get<{ amount: number }>(created.schedule_id)?.amount).toBe(-300000);
    const replay = await depreciationRouter.request("/", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input),
    }, harness.env);
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ schedule_id: created.schedule_id, replayed: true });
    expect(harness.sqlite.query("SELECT COUNT(*) AS n FROM depreciation_schedules WHERE budget_idempotency_key='camera-create-key'")
      .get<{ n: number }>()?.n).toBe(1);
  });

  test("keeps maximum-term create and rebuilds compact enough for one guarded D1 batch", async () => {
    const harness = makeHarness({maxParameters:100});
    harnesses.push(harness);
    const originalDb = harness.env.DB;
    let lastBatchStatementCount = 0;
    let largestBindingCount = 0;
    harness.env.DB = {
      ...originalDb,
      batch: async (statements) => {
        lastBatchStatementCount = statements.length;
        largestBindingCount = Math.max(largestBindingCount,...statements.map(statement =>
          (statement as unknown as {parameters:unknown[]}).parameters.length));
        return originalDb.batch(statements);
      },
    };
    const create = await depreciationRouter.request("/", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        purchase_date: "2026-10-01", description: "Long plan", asset_account_id: harness.assetId,
        payment_account_id: harness.cashId, expense_account_id: harness.expenseId,
        total_amount: 480000, months: 480, currency: "JPY",
        budget_settings: { method: "assigned", purchase_category_id: harness.purchaseCategoryId,
          monthly_source_category_id: harness.sourceCategoryId },
        idempotency_key: "maximum-term-create",
      }),
    }, harness.env);
    expect(create.status).toBe(201);
    expect(lastBatchStatementCount).toBeLessThan(25);
    const created = await create.json() as { schedule_id: number };
    expect(harness.sqlite.query("SELECT COUNT(*) AS n FROM depreciation_entries WHERE schedule_id=?")
      .get<{ n: number }>(created.schedule_id)?.n).toBe(480);
    expect(harness.sqlite.query("SELECT COUNT(*) AS n FROM budget_adjustment_logs WHERE depreciation_schedule_id=?")
      .get<{ n: number }>(created.schedule_id)?.n).toBe(961);

    const patch = await depreciationRouter.request(`/${created.schedule_id}`, {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ description: "Long plan revised" }),
    }, harness.env);
    expect(patch.status).toBe(200);
    expect(lastBatchStatementCount).toBeLessThan(30);
    expect(harness.sqlite.query("SELECT COUNT(*) AS n FROM depreciation_entries WHERE schedule_id=?")
      .get<{ n: number }>(created.schedule_id)?.n).toBe(480);
    expect(harness.sqlite.query("SELECT COUNT(*) AS n FROM budget_adjustment_logs WHERE depreciation_schedule_id=?")
      .get<{ n: number }>(created.schedule_id)?.n).toBe(961);
    const cancel=await depreciationRouter.request(`/${created.schedule_id}`,{method:'DELETE'},harness.env);
    expect(cancel.status).toBe(200);
    expect(largestBindingCount).toBeLessThanOrEqual(100);
    expect(harness.sqlite.query('SELECT id FROM journal_entries').all()).toEqual([{id:harness.purchaseJournalId}]);
    expect(harness.sqlite.query('SELECT id FROM depreciation_schedules').all()).toEqual([{id:harness.scheduleId}]);
  });

  test("creates a compound purchase journal with persisted card offset and clamps budget burden to personal amount", async () => {
    const harness = makeHarness();
    harnesses.push(harness);
    const cardId = harness.sqlite.query(`INSERT INTO accounts(name,type,category,deduct_from_budget)
      VALUES('Card','liability','credit_card',1) RETURNING id`).get<{ id: number }>()!.id;
    const advanceId = harness.sqlite.query(`INSERT INTO accounts(name,type,category)
      VALUES('Employer advance','asset','business_advance') RETURNING id`).get<{ id: number }>()!.id;
    const response = await depreciationRouter.request("/", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        purchase_date: "2026-10-01", description: "Shared purchase",
        asset_account_id: harness.assetId, payment_account_id: harness.cashId,
        expense_account_id: harness.expenseId, total_amount: 250000, months: 25, currency: "JPY",
        purchase_lines: [
          { account_id: harness.assetId, debit: 300000, credit: 0, currency: "JPY" },
          { account_id: harness.cashId, debit: 0, credit: 100000, currency: "JPY" },
          { account_id: cardId, debit: 0, credit: 100000, currency: "JPY", credit_card_billing_offset_months: 2 },
          { account_id: advanceId, debit: 0, credit: 100000, currency: "JPY" },
        ],
        budget_settings: {
          method: "assigned", purchase_category_id: harness.purchaseCategoryId,
          monthly_source_category_id: harness.sourceCategoryId,
        },
        idempotency_key: "shared-purchase-key",
      }),
    }, harness.env);
    expect(response.status).toBe(201);
    const created = await response.json() as { schedule_id: number; source_journal_entry_id: number };
    expect(harness.sqlite.query(`SELECT total_amount,budget_target_amount FROM depreciation_schedules WHERE id=?`)
      .get(created.schedule_id)).toEqual({ total_amount: 250000, budget_target_amount: 200000 });
    expect(harness.sqlite.query(`SELECT debit,credit,credit_card_billing_offset_months FROM journal_lines
      WHERE journal_entry_id=? AND account_id=?`).get(created.source_journal_entry_id, cardId))
      .toEqual({ debit: 0, credit: 100000, credit_card_billing_offset_months: 2 });
    expect(harness.sqlite.query(`SELECT amount FROM budget_adjustment_logs WHERE depreciation_schedule_id=?
      AND depreciation_event_key LIKE 'purchase:%'`).get<{ amount: number }>(created.schedule_id)?.amount).toBe(-200000);
    expect(harness.sqlite.query(`SELECT SUM(amount) AS total FROM budget_adjustment_logs WHERE depreciation_schedule_id=?
      AND depreciation_event_key LIKE 'monthly:%' AND depreciation_event_side='destination'`)
      .get<{ total: number }>(created.schedule_id)?.total).toBe(200000);
    const sourceLinesBefore = harness.sqlite.query(`SELECT account_id,debit,credit,currency,credit_card_billing_offset_months
      FROM journal_lines WHERE journal_entry_id=? ORDER BY id`).all(created.source_journal_entry_id);
    const accountingEdit = await depreciationRouter.request(`/${created.schedule_id}`, {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ total_amount: 260000 }),
    }, harness.env);
    expect(accountingEdit.status).toBe(200);
    expect(harness.sqlite.query(`SELECT account_id,debit,credit,currency,credit_card_billing_offset_months
      FROM journal_lines WHERE journal_entry_id=? ORDER BY id`).all(created.source_journal_entry_id)).toEqual(sourceLinesBefore);
    expect(harness.sqlite.query(`SELECT budget_target_amount FROM depreciation_schedules WHERE id=?`)
      .get<{ budget_target_amount: number }>(created.schedule_id)?.budget_target_amount).toBe(200000);
    const rejectedLineEdit = await depreciationRouter.request(`/${created.schedule_id}`, {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ payment_account_id: advanceId }),
    }, harness.env);
    expect(rejectedLineEdit.status).toBe(409);
    expect(await rejectedLineEdit.json()).toMatchObject({ error: "compound_purchase_lines_required" });
  });

  test("requires the compound purchase asset basis to cover personal depreciation in create and PATCH", async () => {
    const harness = makeHarness();
    harnesses.push(harness);
    const settings: DepreciationBudgetSettings = {
      method: "assigned", purchase_category_id: harness.purchaseCategoryId,
      monthly_source_category_id: harness.sourceCategoryId,
    };
    const createBody = {
      purchase_date: "2026-10-01", description: "Compound basis", asset_account_id: harness.assetId,
      payment_account_id: harness.cashId, expense_account_id: harness.expenseId,
      total_amount: 250000, months: 25, currency: "JPY", budget_settings: settings,
    };
    const wrongAssetType = await depreciationRouter.request("/", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...createBody, asset_account_id: harness.expenseId, idempotency_key: "wrong-asset-type" }),
    }, harness.env);
    expect(wrongAssetType.status).toBe(400);
    expect(await wrongAssetType.json()).toMatchObject({ error: "asset_account_must_be_asset" });
    const wrongExpenseType = await depreciationRouter.request("/", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...createBody, expense_account_id: harness.cashId, idempotency_key: "wrong-expense-type" }),
    }, harness.env);
    expect(wrongExpenseType.status).toBe(400);
    expect(await wrongExpenseType.json()).toMatchObject({ error: "expense_account_must_be_expense" });
    const trackedCashAsset = await depreciationRouter.request("/", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...createBody, asset_account_id: harness.cashId, idempotency_key: "tracked-cash-asset" }),
    }, harness.env);
    expect(trackedCashAsset.status).toBe(400);
    expect(await trackedCashAsset.json()).toMatchObject({ error: "invalid_depreciation_asset_account" });
    const missingAsset = await depreciationRouter.request("/", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...createBody, idempotency_key: "missing-purchase-asset", purchase_lines: [
        { account_id: harness.cashId, debit: 300000, credit: 0, currency: "JPY" },
        { account_id: harness.cashId, debit: 0, credit: 300000, currency: "JPY" },
      ] }),
    }, harness.env);
    expect(missingAsset.status).toBe(400);
    expect(await missingAsset.json()).toMatchObject({ error: "purchase_asset_basis_insufficient" });

    const insufficientAsset = await depreciationRouter.request("/", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...createBody, idempotency_key: "small-purchase-asset", purchase_lines: [
        { account_id: harness.assetId, debit: 100000, credit: 0, currency: "JPY" },
        { account_id: harness.cashId, debit: 150000, credit: 0, currency: "JPY" },
        { account_id: harness.cashId, debit: 0, credit: 250000, currency: "JPY" },
      ] }),
    }, harness.env);
    expect(insufficientAsset.status).toBe(400);
    expect(await insufficientAsset.json()).toMatchObject({ error: "purchase_asset_basis_insufficient" });

    const previewResponse = await postJson(harness, `/${harness.scheduleId}/budget/preview`, { settings });
    const preview = await previewResponse.json() as { token: string; settings: DepreciationBudgetSettings };
    expect((await postJson(harness, `/${harness.scheduleId}/budget/apply`, {
      token: preview.token, settings: preview.settings, confirmed: true,
    })).status).toBe(200);
    const wrongAssetPatch = await depreciationRouter.request(`/${harness.scheduleId}`, {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ asset_account_id: harness.expenseId }),
    }, harness.env);
    expect(wrongAssetPatch.status).toBe(400);
    expect(await wrongAssetPatch.json()).toMatchObject({ error: "asset_account_must_be_asset" });
    const wrongExpensePatch = await depreciationRouter.request(`/${harness.scheduleId}`, {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ expense_account_id: harness.cashId }),
    }, harness.env);
    expect(wrongExpensePatch.status).toBe(400);
    expect(await wrongExpensePatch.json()).toMatchObject({ error: "expense_account_must_be_expense" });
    const trackedCashPatch = await depreciationRouter.request(`/${harness.scheduleId}`, {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ asset_account_id: harness.cashId }),
    }, harness.env);
    expect(trackedCashPatch.status).toBe(400);
    expect(await trackedCashPatch.json()).toMatchObject({ error: "invalid_depreciation_asset_account" });
    const beforeLines = harness.sqlite.query(`SELECT account_id,debit,credit,currency FROM journal_lines
      WHERE journal_entry_id=? ORDER BY id`).all(harness.purchaseJournalId);
    const patch = await depreciationRouter.request(`/${harness.scheduleId}`, {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ total_amount: 250000, purchase_lines: [
        { account_id: harness.assetId, debit: 100000, credit: 0, currency: "JPY" },
        { account_id: harness.cashId, debit: 150000, credit: 0, currency: "JPY" },
        { account_id: harness.cashId, debit: 0, credit: 250000, currency: "JPY" },
      ] }),
    }, harness.env);
    expect(patch.status).toBe(400);
    expect(await patch.json()).toMatchObject({ error: "purchase_asset_basis_insufficient" });
    expect(harness.sqlite.query(`SELECT account_id,debit,credit,currency FROM journal_lines
      WHERE journal_entry_id=? ORDER BY id`).all(harness.purchaseJournalId)).toEqual(beforeLines);
    expect(harness.sqlite.query("SELECT total_amount FROM depreciation_schedules WHERE id=?")
      .get<{ total_amount: number }>(harness.scheduleId)?.total_amount).toBe(300000);
  });

  test("groups paired preview rows into one event and routes assigned reimbursements without moving old burden", async () => {
    const harness = makeHarness();
    harnesses.push(harness);
    seedDepreciationEntry(harness, 1, 10000, "2026-01-01");
    seedDepreciationEntry(harness, 2, 10000, "2026-02-01");
    const settings: DepreciationBudgetSettings = {
      method: "assigned", purchase_category_id: harness.purchaseCategoryId,
      monthly_source_category_id: harness.sourceCategoryId,
    };
    const initial = await postJson(harness, `/${harness.scheduleId}/budget/preview`, { settings });
    const initialPreview = await initial.json() as { token: string; settings: DepreciationBudgetSettings;
      changes: { operation: string; event: { key: string; kind: string; amount: number;
        source_category_id: number | null; destination_category_id: number | null } }[] };
      expect(initialPreview.changes).toHaveLength(3);
    expect(initialPreview.changes.find((change) => change.event.kind === "purchase")?.event).toMatchObject({
      key: `purchase:${harness.purchaseJournalId}`, amount: 300000,
      source_category_id: harness.purchaseCategoryId, destination_category_id: null,
    });
    expect((await postJson(harness, `/${harness.scheduleId}/budget/apply`, {
      token: initialPreview.token, settings: initialPreview.settings, confirmed: true,
    })).status).toBe(200);

    const nextCategory = harness.sqlite.query("INSERT INTO budget_categories(name,budget_group) VALUES('Future target','savings') RETURNING id")
      .get<{ id: number }>()!.id;
    const routedSettings: DepreciationBudgetSettings = {
      ...settings,
      routing_changes: [{ date: "2026-02-01", monthly_source_category_id: harness.sourceCategoryId,
        destination_category_id: nextCategory }],
    };
    const previewResponse = await postJson(harness, `/${harness.scheduleId}/budget/preview`, { settings: routedSettings });
    expect(previewResponse.status).toBe(200);
    const preview = await previewResponse.json() as {
      token: string; settings: DepreciationBudgetSettings;
      changes: { operation: string; event: { key: string; kind: string; source_category_id: number | null;
        destination_category_id: number | null; amount: number } }[];
    };
    expect(preview.changes).toHaveLength(1);
    expect(preview.changes[0]).toMatchObject({
      operation: "change",
      event: {
        key: "monthly:2", kind: "monthly", source_category_id: harness.sourceCategoryId,
        destination_category_id: nextCategory, amount: 10000,
      },
    });
    expect(preview.changes.some((change) => change.event.kind === "routing")).toBe(false);

    const applied = await postJson(harness, `/${harness.scheduleId}/budget/apply`, {
      token: preview.token, settings: preview.settings, confirmed: true,
    });
    expect(applied.status).toBe(200);
    expect(harness.sqlite.query(`SELECT budget_category_id,amount FROM budget_adjustment_logs
      WHERE depreciation_schedule_id=? AND depreciation_event_key='monthly:1' AND depreciation_event_side='destination'`)
      .get(harness.scheduleId)).toEqual({ budget_category_id: harness.purchaseCategoryId, amount: 10000 });
    expect(harness.sqlite.query(`SELECT budget_category_id,amount FROM budget_adjustment_logs
      WHERE depreciation_schedule_id=? AND depreciation_event_key='monthly:2' AND depreciation_event_side='destination'`)
      .get(harness.scheduleId)).toEqual({ budget_category_id: nextCategory, amount: 10000 });
    expect(harness.sqlite.query("SELECT COUNT(*) AS n FROM budget_adjustment_logs WHERE depreciation_schedule_id=? AND depreciation_event_key LIKE 'routing:%'")
      .get<{ n: number }>(harness.scheduleId)?.n).toBe(0);
  });

  test("shows a paired event change when same-day order changes only its stable timestamp", async () => {
    const harness = makeHarness();
    harnesses.push(harness);
    seedDepreciationEntry(harness, 2, 10000, "2026-02-01");
    const resetAt = "2026-02-01 10:00:00";
    const resetId = harness.sqlite.query(`INSERT INTO budget_adjustment_logs
      (budget_category_id,year_month,amount,currency,date,adjustment_type,created_at)
      VALUES(?, '2026-02', 0, 'JPY', '2026-02-01', 'reset', ?) RETURNING id`)
      .get<{ id: number }>(harness.sourceCategoryId, resetAt)!.id;
    const beforeSettings: DepreciationBudgetSettings = {
      method: "assigned", purchase_category_id: harness.purchaseCategoryId,
      monthly_source_category_id: harness.sourceCategoryId,
      reset_decisions: [{ reset_log_id: resetId, action: "continue", same_day_order: "before" }],
    };
    const initial = await postJson(harness, `/${harness.scheduleId}/budget/preview`, { settings: beforeSettings });
    const initialPreview = await initial.json() as { token: string; settings: DepreciationBudgetSettings };
    expect((await postJson(harness, `/${harness.scheduleId}/budget/apply`, {
      token: initialPreview.token, settings: initialPreview.settings, confirmed: true,
    })).status).toBe(200);

    const afterSettings: DepreciationBudgetSettings = {
      ...beforeSettings,
      reset_decisions: [{ reset_log_id: resetId, action: "continue", same_day_order: "after" }],
    };
    const previewResponse = await postJson(harness, `/${harness.scheduleId}/budget/preview`, { settings: afterSettings });
    expect(previewResponse.status).toBe(200);
    const preview = await previewResponse.json() as {
      changes: { operation: string; event: { key: string; kind: string; created_at: string;
        source_category_id: number | null; destination_category_id: number | null } }[];
    };
    expect(preview.changes).toHaveLength(1);
    expect(preview.changes[0]).toMatchObject({ operation: "change", event: {
      key: "monthly:2", kind: "monthly", source_category_id: harness.sourceCategoryId,
      destination_category_id: harness.purchaseCategoryId,
    } });
    expect(preview.changes[0]!.event.created_at).toBe("2026-02-01 10:00:00.001");
  });

  test("rejects a create when a validated budget category changes before its guarded batch", async () => {
    const harness = makeHarness();
    harnesses.push(harness);
    const originalDb = harness.env.DB;
    harness.env.DB = {
      ...originalDb,
      batch: async (statements) => {
        harness.sqlite.query("UPDATE budget_categories SET is_archived=1 WHERE id=?")
          .run(harness.purchaseCategoryId);
        return originalDb.batch(statements);
      },
    };
    const response = await depreciationRouter.request("/", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        purchase_date: "2026-10-01", description: "Racing create", asset_account_id: harness.assetId,
        payment_account_id: harness.cashId, expense_account_id: harness.expenseId,
        total_amount: 300000, months: 30, currency: "JPY",
        budget_settings: {
          method: "assigned", purchase_category_id: harness.purchaseCategoryId,
          monthly_source_category_id: harness.sourceCategoryId,
        },
        idempotency_key: "racing-create-key",
      }),
    }, harness.env);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "stale_budget_snapshot" });
    expect(harness.sqlite.query("SELECT COUNT(*) AS n FROM depreciation_schedules WHERE budget_idempotency_key='racing-create-key'")
      .get<{ n: number }>()?.n).toBe(0);
    expect(harness.sqlite.query("SELECT COUNT(*) AS n FROM journal_entries")
      .get<{ n: number }>()?.n).toBe(1);
  });

  test.each([300000, 10000])("routes %d purchase amount independently for each budget method", async (amount) => {
    for (const method of ["assigned", "special", "unallocated"] as const) {
      const harness = makeHarness();
      harnesses.push(harness);
      const settings: DepreciationBudgetSettings = method === "assigned"
        ? { method, purchase_category_id: harness.purchaseCategoryId, monthly_source_category_id: harness.sourceCategoryId }
        : method === "special"
          ? { method, monthly_source_category_id: harness.sourceCategoryId }
          : { method, confirm_unallocated: true };
      const response = await depreciationRouter.request("/", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          purchase_date: "2026-01-01", description: `${method}-${amount}`,
          asset_account_id: harness.assetId, payment_account_id: harness.cashId,
          expense_account_id: harness.expenseId, total_amount: amount, months: 30,
          currency: "JPY", budget_settings: settings, idempotency_key: `${method}-${amount}`,
        }),
      }, harness.env);
      expect(response.status).toBe(201);
      const { schedule_id: scheduleId } = await response.json() as { schedule_id: number };
      const schedule = harness.sqlite.query("SELECT budget_target_amount,budget_special_category_id FROM depreciation_schedules WHERE id=?")
        .get<{ budget_target_amount: number; budget_special_category_id: number | null }>(scheduleId)!;
      expect(schedule.budget_target_amount).toBe(amount);
      expect(harness.sqlite.query("SELECT COUNT(*) AS n FROM depreciation_budget_reservations WHERE schedule_id=?")
        .get<{ n: number }>(scheduleId)?.n).toBe(0);
      if (method === "unallocated") {
        expect(harness.sqlite.query("SELECT COUNT(*) AS n FROM budget_adjustment_logs WHERE depreciation_schedule_id=?")
          .get<{ n: number }>(scheduleId)?.n).toBe(0);
        continue;
      }
      const purchaseCategory = method === "special" ? schedule.budget_special_category_id! : harness.purchaseCategoryId;
      expect(harness.sqlite.query("SELECT amount FROM budget_adjustment_logs WHERE depreciation_schedule_id=? AND depreciation_event_key LIKE 'purchase:%'")
        .get<{ amount: number }>(scheduleId)?.amount).toBe(-amount);
      expect(harness.sqlite.query("SELECT SUM(amount) AS total FROM budget_adjustment_logs WHERE depreciation_schedule_id=? AND depreciation_event_side='source' AND depreciation_event_key LIKE 'monthly:%'")
        .get<{ total: number | null }>(scheduleId)?.total).toBe(-amount);
      expect(harness.sqlite.query("SELECT SUM(amount) AS total FROM budget_adjustment_logs WHERE depreciation_schedule_id=? AND budget_category_id=? AND depreciation_event_side='destination' AND depreciation_event_key LIKE 'monthly:%'")
        .get<{ total: number | null }>(scheduleId, purchaseCategory)?.total).toBe(amount);
    }
  });

  test("preserves the owned special category and unrelated balance across method switches and deletion", async () => {
    const harness = makeHarness();
    harnesses.push(harness);
    const special: DepreciationBudgetSettings = {
      method: "special", monthly_source_category_id: harness.sourceCategoryId,
    };
    const assigned: DepreciationBudgetSettings = {
      method: "assigned", purchase_category_id: harness.purchaseCategoryId,
      monthly_source_category_id: harness.sourceCategoryId,
    };
    const apply = async (settings: DepreciationBudgetSettings) => {
      const previewResponse = await postJson(harness, `/${harness.scheduleId}/budget/preview`, { settings });
      expect(previewResponse.status).toBe(200);
      const preview = await previewResponse.json() as { token: string; settings: DepreciationBudgetSettings };
      return postJson(harness, `/${harness.scheduleId}/budget/apply`, {
        token: preview.token, settings: preview.settings, confirmed: true,
      });
    };

    expect((await apply(special)).status).toBe(200);
    const specialId = harness.sqlite.query("SELECT budget_special_category_id FROM depreciation_schedules WHERE id=?")
      .get<{ budget_special_category_id: number }>(harness.scheduleId)!.budget_special_category_id;
    harness.sqlite.query(`INSERT INTO budget_adjustment_logs
      (budget_category_id,year_month,amount,currency,date,adjustment_type,note)
      VALUES(?, '2026-01', 50000, 'JPY', '2026-01-01', 'manual', 'Unrelated balance')`)
      .run(specialId);

    expect((await apply(assigned)).status).toBe(200);
    expect(harness.sqlite.query("SELECT budget_special_category_id FROM depreciation_schedules WHERE id=?")
      .get<{ budget_special_category_id: number }>(harness.scheduleId)?.budget_special_category_id).toBe(specialId);
    expect(harness.sqlite.query("SELECT is_archived FROM budget_categories WHERE id=?")
      .get<{ is_archived: number }>(specialId)?.is_archived).toBe(0);
    expect(harness.sqlite.query("SELECT amount FROM budget_adjustment_logs WHERE budget_category_id=? AND note='Unrelated balance'")
      .get<{ amount: number }>(specialId)?.amount).toBe(50000);

    expect((await apply(special)).status).toBe(200);
    expect(harness.sqlite.query("SELECT COUNT(*) AS n FROM budget_categories WHERE budget_group='減価償却'")
      .get<{ n: number }>()?.n).toBe(1);
    expect(harness.sqlite.query("SELECT budget_special_category_id FROM depreciation_schedules WHERE id=?")
      .get<{ budget_special_category_id: number }>(harness.scheduleId)?.budget_special_category_id).toBe(specialId);

    const deleted = await depreciationRouter.request(`/${harness.scheduleId}`, { method: "DELETE" }, harness.env);
    expect(deleted.status).toBe(200);
    expect(harness.sqlite.query("SELECT is_archived FROM budget_categories WHERE id=?")
      .get<{ is_archived: number }>(specialId)?.is_archived).toBe(0);
    expect(harness.sqlite.query("SELECT amount FROM budget_adjustment_logs WHERE budget_category_id=? AND note='Unrelated balance'")
      .get<{ amount: number }>(specialId)?.amount).toBe(50000);
  });

  test("repairs only linked legacy reservations and depreciation allocations without double charging", async () => {
    const harness = makeHarness();
    harnesses.push(harness);
    harness.sqlite.query("INSERT INTO depreciation_budget_reservations(schedule_id,budget_category_id,amount,currency) VALUES(?,?,300000,'JPY')")
      .run(harness.scheduleId, harness.purchaseCategoryId);
    harness.sqlite.query(`INSERT INTO journal_entry_budget_allocations(journal_entry_id,budget_category_id,amount,currency,source)
      VALUES(?,?, -300000,'JPY','depreciation')`).run(harness.purchaseJournalId, harness.purchaseCategoryId);
    const monthlyJournal = harness.sqlite.query(`INSERT INTO journal_entries(date,description,created_at)
      VALUES('2026-02-01','Legacy depreciation','2026-02-01 10:00:00') RETURNING id`).get<{ id: number }>()!.id;
    harness.sqlite.query(`INSERT INTO journal_lines(journal_entry_id,account_id,debit,credit,currency)
      VALUES(?,?,10000,0,'JPY'),(?,?,0,10000,'JPY')`).run(monthlyJournal, harness.expenseId, monthlyJournal, harness.assetId);
    harness.sqlite.query("INSERT INTO depreciation_entries(schedule_id,journal_entry_id,month_number) VALUES(?,?,1)")
      .run(harness.scheduleId, monthlyJournal);
    harness.sqlite.query(`INSERT INTO journal_entry_budget_allocations(journal_entry_id,budget_category_id,amount,currency,source)
      VALUES(?,?, -10000,'JPY','depreciation')`).run(monthlyJournal, harness.purchaseCategoryId);

    const preview = await postJson(harness, `/${harness.scheduleId}/budget/preview`, {
      settings: { method: "assigned", purchase_category_id: harness.purchaseCategoryId, monthly_source_category_id: harness.sourceCategoryId },
    });
    const previewBody = await preview.json() as { token: string; settings: DepreciationBudgetSettings };
    const applied = await postJson(harness, `/${harness.scheduleId}/budget/apply`, {
      token: previewBody.token, settings: previewBody.settings, confirmed: true,
    });
    expect(applied.status).toBe(200);
    expect(harness.sqlite.query("SELECT COUNT(*) AS n FROM depreciation_budget_reservations WHERE schedule_id=?")
      .get<{ n: number }>(harness.scheduleId)?.n).toBe(0);
    expect(harness.sqlite.query("SELECT COUNT(*) AS n FROM journal_entry_budget_allocations WHERE source='depreciation' AND journal_entry_id IN (?,?)")
      .get<{ n: number }>(harness.purchaseJournalId, monthlyJournal)?.n).toBe(0);
    expect(harness.sqlite.query("SELECT amount FROM budget_adjustment_logs WHERE depreciation_schedule_id=? AND depreciation_event_key LIKE 'purchase:%'")
      .get<{ amount: number }>(harness.scheduleId)?.amount).toBe(-300000);
    expect(harness.sqlite.query("SELECT SUM(amount) AS total FROM budget_adjustment_logs WHERE depreciation_schedule_id=? AND depreciation_event_key LIKE 'monthly:%' AND depreciation_event_side='destination'")
      .get<{ total: number | null }>(harness.scheduleId)?.total).toBe(10000);
  });

  test("rebuilds configured accounting edits atomically and retains audit history after deletion", async () => {
    const harness = makeHarness();
    harnesses.push(harness);
    const settings: DepreciationBudgetSettings = {
      method: "assigned", purchase_category_id: harness.purchaseCategoryId,
      monthly_source_category_id: harness.sourceCategoryId,
    };
    const preview = await postJson(harness, `/${harness.scheduleId}/budget/preview`, { settings });
    const previewBody = await preview.json() as { token: string; settings: DepreciationBudgetSettings };
    expect((await postJson(harness, `/${harness.scheduleId}/budget/apply`, {
      token: previewBody.token, settings: previewBody.settings, confirmed: true,
    })).status).toBe(200);

    const edit = {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ total_amount: 330000, idempotency_key: "edit-one" }),
    };
    const editResponse = await depreciationRouter.request(`/${harness.scheduleId}`, edit, harness.env);
    expect(editResponse.status).toBe(200);
    expect(harness.sqlite.query("SELECT total_amount,budget_target_amount,budget_revision FROM depreciation_schedules WHERE id=?")
      .get(harness.scheduleId)).toEqual({ total_amount: 330000, budget_target_amount: 330000, budget_revision: 2 });
    expect(harness.sqlite.query("SELECT amount FROM budget_adjustment_logs WHERE depreciation_schedule_id=? AND depreciation_event_key LIKE 'purchase:%'")
      .get<{ amount: number }>(harness.scheduleId)?.amount).toBe(-330000);
    const retry = await depreciationRouter.request(`/${harness.scheduleId}`, edit, harness.env);
    expect(retry.status).toBe(200);
    expect(await retry.json()).toMatchObject({ replayed: true });

    const deletion = await depreciationRouter.request(`/${harness.scheduleId}`, { method: "DELETE" }, harness.env);
    expect(deletion.status).toBe(200);
    expect(harness.sqlite.query("SELECT COUNT(*) AS n FROM depreciation_schedules WHERE id=?")
      .get<{ n: number }>(harness.scheduleId)?.n).toBe(0);
    expect(harness.sqlite.query("SELECT COUNT(*) AS n FROM depreciation_budget_revisions WHERE schedule_id=?")
      .get<{ n: number }>(harness.scheduleId)?.n).toBe(3);
  });

  test("rebuilds edits through a saved reset and partial settlement without duplicating receipts", async () => {
    const harness = makeHarness();
    harnesses.push(harness);
    for (let month = 1; month <= 10; month += 1) {
      seedDepreciationEntry(harness, month, 10000, `2026-${String(month).padStart(2, "0")}-01`);
    }
    const reset = harness.sqlite.query(`INSERT INTO budget_adjustment_logs
      (budget_category_id,year_month,amount,currency,date,adjustment_type,created_at,reset_scope)
      VALUES(?,'2026-06',0,'JPY','2026-06-01','reset','2026-06-01 23:59:59','category') RETURNING id`)
      .get<{ id: number }>(harness.sourceCategoryId)!;
    const settings: DepreciationBudgetSettings = {
      method: "assigned", purchase_category_id: harness.purchaseCategoryId,
      monthly_source_category_id: harness.sourceCategoryId,
      reset_decisions: [{ reset_log_id: reset.id, action: "continue", scope: "category" }],
      settlements: [{ key: "partial-edit", date: toLocalDateString(), amount: 50000, source_category_id: null }],
    };
    const preview = await postJson(harness, `/${harness.scheduleId}/budget/preview`, { settings });
    expect(preview.status).toBe(200);
    const previewBody = await preview.json() as { token: string; settings: DepreciationBudgetSettings };
    const applied = await postJson(harness, `/${harness.scheduleId}/budget/apply`, {
      token: previewBody.token, settings: previewBody.settings, confirmed: true,
    });
    expect(applied.status).toBe(200);

    const request = {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ total_amount: 330000, idempotency_key: "edit-after-settlement" }),
    };
    const first = await depreciationRouter.request(`/${harness.scheduleId}`, request, harness.env);
    expect(first.status).toBe(200);
    const rows = harness.sqlite.query(`SELECT depreciation_event_key,depreciation_event_side,amount FROM budget_adjustment_logs
      WHERE depreciation_schedule_id=?`).all<{ depreciation_event_key: string; depreciation_event_side: string; amount: number }>(harness.scheduleId);
    expect(rows.filter((row) => row.depreciation_event_key === "settlement:partial-edit")).toHaveLength(1);
    expect(rows.some((row) => row.depreciation_event_key === "carry:reset:" + reset.id)).toBe(false);
    expect(rows.filter((row) => row.depreciation_event_side === "destination" &&
      (row.depreciation_event_key.startsWith("monthly:") || row.depreciation_event_key.startsWith("settlement:")))
      .reduce((sum, row) => sum + row.amount, 0)).toBe(330000);
    const persisted = JSON.parse(harness.sqlite.query("SELECT budget_settings FROM depreciation_schedules WHERE id=?")
      .get<{ budget_settings: string }>(harness.scheduleId)!.budget_settings) as DepreciationBudgetSettings;
    expect(persisted.reset_decisions).toContainEqual(expect.objectContaining({ reset_log_id: reset.id, action: "continue" }));

    const retry = await depreciationRouter.request(`/${harness.scheduleId}`, request, harness.env);
    expect(retry.status).toBe(200);
    expect(await retry.json()).toMatchObject({ replayed: true });
    expect(harness.sqlite.query(`SELECT COUNT(*) AS n FROM budget_adjustment_logs
      WHERE depreciation_schedule_id=? AND depreciation_event_key='settlement:partial-edit'`)
      .get<{ n: number }>(harness.scheduleId)?.n).toBe(1);
  });

  test("rejects a purchase reduction below an existing settlement without mutating the plan", async () => {
    const harness = makeHarness();
    harnesses.push(harness);
    const settings: DepreciationBudgetSettings = {
      method: "assigned", purchase_category_id: harness.purchaseCategoryId,
      monthly_source_category_id: harness.sourceCategoryId,
      settlements: [{ key: "paid-back", date: toLocalDateString(), amount: 50000, source_category_id: null }],
    };
    const preview = await postJson(harness, `/${harness.scheduleId}/budget/preview`, { settings });
    const previewBody = await preview.json() as { token: string; settings: DepreciationBudgetSettings };
    expect((await postJson(harness, `/${harness.scheduleId}/budget/apply`, {
      token: previewBody.token, settings: previewBody.settings, confirmed: true,
    })).status).toBe(200);
    const before = harness.sqlite.query(`SELECT depreciation_event_key,depreciation_event_side,amount FROM budget_adjustment_logs
      WHERE depreciation_schedule_id=? ORDER BY id`).all(harness.scheduleId);
    const failed = await depreciationRouter.request(`/${harness.scheduleId}`, {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ total_amount: 49000, idempotency_key: "invalid-reduction" }),
    }, harness.env);
    expect(failed.status).toBe(409);
    expect(await failed.json()).toMatchObject({ error: "settlement_exceeds_remaining_principal" });
    expect(harness.sqlite.query("SELECT total_amount FROM depreciation_schedules WHERE id=?")
      .get<{ total_amount: number }>(harness.scheduleId)?.total_amount).toBe(300000);
    expect(harness.sqlite.query(`SELECT depreciation_event_key,depreciation_event_side,amount FROM budget_adjustment_logs
      WHERE depreciation_schedule_id=? ORDER BY id`).all(harness.scheduleId)).toEqual(before);
  });

  test("lists unconfigured legacy schedules without assigning a method", async () => {
    const harness = makeHarness();
    harnesses.push(harness);
    const response = await depreciationRouter.request("/", {}, harness.env);
    expect(response.status).toBe(200);
    const schedules = (await response.json()) as { id: number; budget: { method: string | null; status: string } }[];
    expect(schedules).toContainEqual(
      expect.objectContaining({
        id: harness.scheduleId,
        budget: expect.objectContaining({ method: null, status: "unset" }),
      }),
    );
  });
});
