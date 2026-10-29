import { getTableColumns, getTableName } from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import type { JournalDeletionCandidate, JournalEntry } from "@balance-sheet/shared";
import {
  journalEntries, journalLines, journalEntryBudgetAllocations, budgetAdjustmentLogs,
  budgetFundingAllocations, loanSettlements, incomeTransferRequirements,
  depreciationSchedules, depreciationEntries, actualBalanceAdjustments,
  type JournalDeletionCandidateRow,
} from "../db/schema";
import { fromStorageMoneyAmount } from "./moneyValidation";

// Identifiers below come exclusively from the schema and fixed internal expressions.
function objectSql(table: SQLiteTable, alias: string, extra: Record<string, string> = {}) {
  const columns = Object.values(getTableColumns(table));
  const names = new Set(columns.map(column => column.name));
  const pairs = columns.flatMap(column => [
    `'${column.name}'`, extra[column.name] ?? `${alias}."${column.name}"`,
  ]);
  for (const [key, expression] of Object.entries(extra)) {
    if (!names.has(key)) pairs.push(`'${key}'`, expression);
  }
  return `json_object(${pairs.join(",")})`;
}

function arraySql(table: SQLiteTable, condition: string, category = false, extraFields: Record<string, string> = {}) {
  const hasSavedName = "budget_category_name" in getTableColumns(table);
  const extra: Record<string, string> = {
    ...(category ? { budget_category_name: hasSavedName ? "COALESCE(r.budget_category_name,bc.name)" : "bc.name" } : {}),
    ...extraFields,
  };
  return `(SELECT json_group_array(${objectSql(table, "r", extra)})
    FROM "${getTableName(table)}" r
    ${category ? "LEFT JOIN budget_categories bc ON bc.id=r.budget_category_id" : ""}
    WHERE ${condition})`;
}

const associatedSql: Record<string, string> = {
  journal_entry_budget_allocations: arraySql(journalEntryBudgetAllocations, "r.journal_entry_id=e.id", true),
  budget_adjustment_logs: arraySql(budgetAdjustmentLogs, "r.journal_entry_id=e.id", true),
  budget_funding_allocations: arraySql(budgetFundingAllocations, "r.journal_entry_id=e.id OR r.source_journal_entry_id=e.id", true),
  loan_settlements: arraySql(loanSettlements, "r.journal_entry_id=e.id OR r.settled_by_journal_entry_id=e.id"),
  income_transfer_requirements: arraySql(incomeTransferRequirements, "r.source_income_journal_entry_id=e.id OR r.transfer_journal_entry_id=e.id", true),
  depreciation_schedules: arraySql(depreciationSchedules, "r.source_journal_entry_id=e.id OR r.id IN (SELECT schedule_id FROM depreciation_entries WHERE journal_entry_id=e.id)"),
  depreciation_entries: arraySql(depreciationEntries, "r.journal_entry_id=e.id"),
  actual_balance_adjustments: arraySql(actualBalanceAdjustments, "r.journal_entry_id=e.id", false, {
    currency: "(SELECT currency FROM actual_balance_entries WHERE id=r.actual_balance_entry_id)",
  }),
};

const snapshotSql = `json_object(
  'version',1,
  'entry',${objectSql(journalEntries, "e", { income_budget_filter_name: "(SELECT name FROM budget_filters WHERE id=e.income_budget_filter_id)" })},
  'lines',(SELECT json_group_array(${objectSql(journalLines, "l", { account_name: "a.name" })})
    FROM journal_lines l LEFT JOIN accounts a ON a.id=l.account_id WHERE l.journal_entry_id=e.id),
  'currency_decimal_places',(SELECT json_group_object(code,decimal_places) FROM enabled_currencies),
  'related',json_object(${Object.entries(associatedSql).flatMap(([key, value]) => [`'${key}'`, value]).join(",")})
)`;

/** Prepend before changing any header, lines, or linked metadata. Execute in the mutation batch. */
export function buildJournalHistoryStatements(
  DB: D1Database,
  entryIds: number[],
  reason: "deleted" | "edited",
): D1PreparedStatement[] {
  const ids = [...new Set(entryIds)];
  if (ids.some(id => !Number.isSafeInteger(id) || id <= 0)) throw new Error("Invalid journal history id");
  const statements: D1PreparedStatement[] = [];
  for (let index = 0; index < ids.length; index += 50) {
    const chunk = ids.slice(index, index + 50);
    statements.push(DB.prepare(`INSERT INTO journal_deletion_candidates
      (original_journal_entry_id,reason,snapshot)
      SELECT e.id,?,${snapshotSql} FROM journal_entries e
      WHERE e.id IN (${chunk.map(() => "?").join(",")}) ORDER BY e.id ASC
    `).bind(reason, ...chunk));
  }
  return statements;
}

type RawRecord = Record<string, unknown>;
type Snapshot = {
  entry: RawRecord;
  lines: RawRecord[];
  related: Record<string, RawRecord[]>;
  currency_decimal_places: Record<string, number>;
};

export function serializeJournalHistory(row: JournalDeletionCandidateRow): JournalDeletionCandidate {
  const snapshot = JSON.parse(row.snapshot) as Snapshot;
  const scaleOptions = { decimalPlacesByCurrency: snapshot.currency_decimal_places };
  const decode = (record: RawRecord) => {
    const output = { ...record };
    for (const key of ["debit", "credit", "amount", "total_amount", "budget_target_amount"]) {
      if (typeof output[key] === "number") {
        output[key] = fromStorageMoneyAmount(output[key] as number, (output.currency ?? output.budget_currency) as string | undefined, scaleOptions);
      }
    }
    return output;
  };
  const related = Object.fromEntries(Object.entries(snapshot.related).map(([key, records]) => [key, records.map(decode)]));
  const entry = {
    ...snapshot.entry,
    is_regular_income: Boolean(snapshot.entry.is_regular_income),
    lines: snapshot.lines.sort((a, b) => Number(a.id) - Number(b.id)).map(decode),
    budget_allocations: (related.journal_entry_budget_allocations ?? []).map(record => ({ ...record, is_reference: Boolean(record.is_reference) })),
    income_budget_allocations: related.budget_adjustment_logs ?? [],
  } as unknown as JournalEntry;
  return {
    id: row.id,
    original_journal_entry_id: row.original_journal_entry_id,
    is_deleted: true,
    reason: row.reason,
    archived_at: row.archived_at,
    entry,
    related_records: related,
  };
}
