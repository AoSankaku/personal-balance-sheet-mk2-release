import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { BudgetPlacementReconciliation, IncomeTransferRequirement } from "@balance-sheet/shared";
import { generateBudgetPlacementPlan } from "../../../shared/budgetPlacement";
import { isAfterBudgetResetPoint } from "./budgetSummary";
import { accountsRouter } from "../routes/accounts";
import { computeBudgetSummaryForDate } from "../routes/budget";
import { createDb, type Env } from "../db";
import { budgetAdjustmentLogs, budgetCategoryAccountTargets, incomeTransferRequirements, journalEntries, journalEntryBudgetAllocations, journalLines } from "../db/schema";
import { readBudgetMutationRevision, runBudgetGuardedBatch } from "./d1Mutation";
import { loadCurrencyDecimalPlaces } from "./currencyPrecision";
import { toLocalDateString } from "./appDate";
import { fromStorageMoneyAmount, toStorageMoneyAmount } from "./moneyValidation";
import { groupIncomeTransferRequirements } from "./incomeTransferRequirements";
import { chunkForD1InClause } from "./d1Query";
import { buildActualBalanceAdjustmentRefreshStatements } from "./actualBalanceAdjustments";

type RequirementRow = typeof incomeTransferRequirements.$inferSelect & {
  source_income_date: string;
  source_income_description: string;
};
type D1QueryResult<T> = { results?: T[] };

function tokenFor(value: unknown) {
  const text = JSON.stringify(value);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function snapshotSql(query: string, parameters: unknown[] = []) {
  return { query, parameters };
}

function requirementSnapshot(rows: RequirementRow[]) {
  return rows.map(row => [row.id, row.source_income_date, row.from_account_id, row.to_account_id, row.amount, row.currency, row.is_deferred]);
}

async function getSnapshot(db: ReturnType<typeof createDb>, env: Env, currency: string) {
  const asOf = toLocalDateString();
  const initialRevision = await readBudgetMutationRevision(env.DB);
  const [accountsResponse, summary, rows, targetRows, decimalPlacesByCurrency] = await Promise.all([
    accountsRouter.request(`/?as_of=${asOf}`, {}, env),
    computeBudgetSummaryForDate(db, asOf, currency),
    db.select({ id: incomeTransferRequirements.id, source_income_journal_entry_id: incomeTransferRequirements.source_income_journal_entry_id, budget_category_id: incomeTransferRequirements.budget_category_id, budget_category_name: incomeTransferRequirements.budget_category_name, from_account_id: incomeTransferRequirements.from_account_id, to_account_id: incomeTransferRequirements.to_account_id, amount: incomeTransferRequirements.amount, currency: incomeTransferRequirements.currency, transfer_journal_entry_id: incomeTransferRequirements.transfer_journal_entry_id, completion_source: incomeTransferRequirements.completion_source, is_deferred: incomeTransferRequirements.is_deferred, created_at: incomeTransferRequirements.created_at, completed_at: incomeTransferRequirements.completed_at, source_income_date: journalEntries.date, source_income_description: journalEntries.description })
      .from(incomeTransferRequirements).innerJoin(journalEntries, eq(incomeTransferRequirements.source_income_journal_entry_id, journalEntries.id))
      .where(and(sql`${incomeTransferRequirements.completion_source} IS NULL`, eq(incomeTransferRequirements.currency, currency))).orderBy(incomeTransferRequirements.id),
    db.select({
      budget_category_id: budgetCategoryAccountTargets.budget_category_id,
      account_id: budgetCategoryAccountTargets.account_id,
      ratio: budgetCategoryAccountTargets.ratio,
      ratio_signature: sql<string>`CASE WHEN ${budgetCategoryAccountTargets.ratio}=CAST(${budgetCategoryAccountTargets.ratio} AS INTEGER) THEN CAST(CAST(${budgetCategoryAccountTargets.ratio} AS INTEGER) AS TEXT) ELSE CAST(${budgetCategoryAccountTargets.ratio} AS TEXT) END`,
    }).from(budgetCategoryAccountTargets).orderBy(budgetCategoryAccountTargets.budget_category_id, budgetCategoryAccountTargets.account_id),
    loadCurrencyDecimalPlaces(db),
  ]);
  if (accountsResponse.status !== 200) throw new Error("budget_placement_accounts_unavailable");
  const accountRows = await accountsResponse.json() as Array<{ id: number; name: string; type: string; category: string; balances?: Record<string, number>; balance?: number | null; include_in_allocatable: boolean; is_depreciable: boolean; deduct_from_budget: boolean }>;
  const currencyScale = decimalPlacesByCurrency[currency] ?? 0;
  const summaries = summary.categories.map(item => ({ ...item, category: { ...item.category, target_accounts: targetRows.filter(target => target.budget_category_id === item.category.id).map(target => ({ account_id: target.account_id, ratio: target.ratio })) } }));
  const plan = generateBudgetPlacementPlan({ accounts: accountRows, categorySummaries: summaries, currency, decimalPlaces: currencyScale });
  const eligibleAccountIds = new Set(accountRows.filter(account => account.type === "asset" && account.category === "cash" && account.include_in_allocatable && !account.is_depreciable).map(account => account.id));
  const coveredRows = rows.filter(row => row.source_income_date <= asOf && eligibleAccountIds.has(row.from_account_id) && eligibleAccountIds.has(row.to_account_id));
  const accountById = new Map(accountRows.map(account => [account.id, account]));
  const requirements: IncomeTransferRequirement[] = coveredRows.map(row => ({ ...row, amount: fromStorageMoneyAmount(row.amount, row.currency, { decimalPlacesByCurrency }), is_deferred: row.is_deferred == null ? null : Boolean(row.is_deferred), from_account_name: accountById.get(row.from_account_id)?.name, to_account_name: accountById.get(row.to_account_id)?.name }));
  const targetSnapshot = targetRows.map(row => [row.budget_category_id, row.account_id, row.ratio]);
  const targetSignature = targetRows.map(row => `${row.budget_category_id}:${row.account_id}:${row.ratio_signature}`).join("|");
  const expenseEvidence = await getExpenseEvidence(db, accountRows, summaries, plan.groups, currency, asOf, decimalPlacesByCurrency);
  const finalRevision = await readBudgetMutationRevision(env.DB);
  if (initialRevision !== finalRevision) throw new Error("budget_placement_read_conflict");
  const revision = finalRevision;
  const snapshot = { asOf, currency, revision, requirements: requirementSnapshot(rows), targets: targetSnapshot, targetSignature };
  const epsilon = 0.5 / 10 ** currencyScale;
  const unresolvedRequirementIds = coveredRows.filter(row => {
    const destinationGroup = plan.groups.find(group => group.account_ids.includes(row.to_account_id));
    return !destinationGroup || destinationGroup.after_difference + destinationGroup.retained_shortage < -epsilon;
  }).map(row => row.id);
  const result: BudgetPlacementReconciliation = {
    ...plan, as_of: asOf, currency, revision, token: tokenFor(snapshot),
    requirement_ids: coveredRows.map(row => row.id),
    unresolved_requirement_ids: unresolvedRequirementIds,
    pending_transfers: groupIncomeTransferRequirements(requirements), expense_evidence: expenseEvidence,
  };
  return { result, snapshot };
}

async function getExpenseEvidence(db: ReturnType<typeof createDb>, accountRows: Array<{ id: number; name: string; type: string; category: string }>, summaries: Array<{ category: { id: number; name: string } }>, groups: BudgetPlacementReconciliation["groups"], currency: string, asOf: string, decimalPlacesByCurrency: Record<string, number | null | undefined>): Promise<BudgetPlacementReconciliation["expense_evidence"]> {
  const summaryById = new Map(summaries.map(row => [row.category.id, row]));
  const [allAllocations, resetRows] = await Promise.all([
    db.select({ journal_entry_id: journalEntryBudgetAllocations.journal_entry_id, budget_category_id: journalEntryBudgetAllocations.budget_category_id, amount: journalEntryBudgetAllocations.amount, date: journalEntries.date, created_at: journalEntries.created_at, description: journalEntries.description, source: journalEntryBudgetAllocations.source, is_reference: journalEntryBudgetAllocations.is_reference })
      .from(journalEntryBudgetAllocations).innerJoin(journalEntries, eq(journalEntryBudgetAllocations.journal_entry_id, journalEntries.id))
      .where(and(
        eq(journalEntryBudgetAllocations.currency, currency),
        or(
          eq(journalEntryBudgetAllocations.source, "expense"),
          and(isNull(journalEntryBudgetAllocations.source), sql`${journalEntryBudgetAllocations.amount} < 0`),
        ),
        sql`${journalEntries.date} <= ${asOf}`,
      )),
    db.select({ budget_category_id: budgetAdjustmentLogs.budget_category_id, date: budgetAdjustmentLogs.date, created_at: budgetAdjustmentLogs.created_at })
      .from(budgetAdjustmentLogs)
      .where(and(eq(budgetAdjustmentLogs.currency, currency), eq(budgetAdjustmentLogs.adjustment_type, "reset"), sql`${budgetAdjustmentLogs.date} <= ${asOf}`))
      .orderBy(budgetAdjustmentLogs.date, budgetAdjustmentLogs.created_at),
  ]);
  const resetPointByCategory = new Map<number, { date: string; created_at: string | null }>();
  for (const row of resetRows) resetPointByCategory.set(row.budget_category_id, { date: row.date, created_at: row.created_at });
  const allocations = allAllocations.filter(row => !row.is_reference && isAfterBudgetResetPoint(
    { date: row.date, created_at: row.created_at },
    resetPointByCategory.get(row.budget_category_id) ?? null,
  ));
  if (!allocations.length) return [];
  const entryIds = [...new Set(allocations.map(row => row.journal_entry_id))];
  const lines = (await Promise.all(chunkForD1InClause(entryIds).map(entryChunk => db.select({ journal_entry_id: journalLines.journal_entry_id, account_id: journalLines.account_id, debit: journalLines.debit, credit: journalLines.credit, currency: journalLines.currency })
    .from(journalLines).where(and(inArray(journalLines.journal_entry_id, entryChunk), eq(journalLines.currency, currency)))))).flat();
  const accountById = new Map(accountRows.map(row => [row.id, row]));
  const groupByCategory = new Map<number, string>();
  for (const group of groups) for (const category of group.categories) groupByCategory.set(category.budget_category_id, group.group_id);
  const groupById = new Map(groups.map(group => [group.group_id, group]));
  const evidence: BudgetPlacementReconciliation["expense_evidence"] = [];
  for (const entryId of entryIds) {
    const entryLines = lines.filter(row => row.journal_entry_id === entryId);
    const payments = entryLines.filter(row => row.credit > 0 && accountById.get(row.account_id)?.type === "asset" && accountById.get(row.account_id)?.category === "cash");
    const expenseDebits = entryLines.filter(row => row.debit > 0 && accountById.get(row.account_id)?.type === "expense");
    const entryAllocations = allocations.filter(row => row.journal_entry_id === entryId);
    if (entryLines.length !== 2 || payments.length !== 1 || expenseDebits.length !== 1 || entryAllocations.reduce((sum, row) => sum + Math.abs(row.amount), 0) !== payments[0]!.credit) continue;
    for (const row of entryAllocations) {
      const groupId = groupByCategory.get(row.budget_category_id);
      const category = summaryById.get(row.budget_category_id)?.category;
      const account = accountById.get(payments[0]!.account_id);
      if (groupId && category && account && !groupById.get(groupId)?.account_ids.includes(account.id)) evidence.push({ journal_entry_id: row.journal_entry_id, date: row.date, description: row.description, budget_category_id: row.budget_category_id, budget_category_name: category.name, from_account_id: account.id, from_account_name: account.name, to_group_id: groupId, amount: Math.abs(fromStorageMoneyAmount(row.amount, currency, { decimalPlacesByCurrency })) });
    }
  }
  return evidence;
}

export async function previewBudgetPlacement(env: Env, currency: string) {
  const db = createDb(env);
  return (await getSnapshot(db, env, currency.toUpperCase())).result;
}

export async function completeBudgetPlacement(env: Env, input: { currency: string; token: string; description: string }) {
  const currency = input.currency.toUpperCase();
  const db = createDb(env);
  const initial = await getSnapshot(db, env, currency);
  if (initial.result.token !== input.token) return { status: 409 as const, body: { error: "budget_placement_stale" } };
  const preview = initial.result;
  const unresolvedIds = new Set(preview.unresolved_requirement_ids);
  const completedRequirementIds = preview.requirement_ids.filter(id => !unresolvedIds.has(id));
  if (preview.transfers.length === 0 && completedRequirementIds.length === 0) {
    return { status: 409 as const, body: { error: unresolvedIds.size > 0 ? "budget_placement_unresolved_requirements" : "budget_placement_already_reconciled", unresolved_requirement_ids: [...unresolvedIds] } };
  }
  const now = new Date().toISOString();
  const source = preview.as_of;
  const decimalPlacesByCurrency = await loadCurrencyDecimalPlaces(db);
  const transferRows = preview.transfers.flatMap(transfer => [
    { account_id: transfer.to_account_id, debit: toStorageMoneyAmount(transfer.amount, currency, { decimalPlacesByCurrency }), credit: 0 },
    { account_id: transfer.from_account_id, debit: 0, credit: toStorageMoneyAmount(transfer.amount, currency, { decimalPlacesByCurrency }) },
  ]);
  const conditional = snapshotSql(`UPDATE depreciation_budget_apply_guard SET expected_revision = CASE
    WHEN ? = COALESCE((SELECT GROUP_CONCAT(value, '|') FROM (
      SELECT CAST(budget_category_id AS TEXT)||':'||CAST(account_id AS TEXT)||':'||CASE WHEN ratio=CAST(ratio AS INTEGER) THEN CAST(CAST(ratio AS INTEGER) AS TEXT) ELSE CAST(ratio AS TEXT) END AS value
      FROM budget_category_account_targets ORDER BY budget_category_id, account_id)), '')
    AND ? = COALESCE((SELECT GROUP_CONCAT(value, '|') FROM (
      SELECT CAST(r.id AS TEXT)||':'||j.date||':'||CAST(r.from_account_id AS TEXT)||':'||CAST(r.to_account_id AS TEXT)||':'||CAST(r.amount AS TEXT)||':'||r.currency||':'||COALESCE(CAST(r.is_deferred AS TEXT),'') AS value
      FROM income_transfer_requirements r JOIN journal_entries j ON j.id=r.source_income_journal_entry_id
      WHERE r.completion_source IS NULL AND r.currency=? ORDER BY r.id)), '')
    THEN expected_revision + 1 ELSE -1 END WHERE id=1`, [initial.snapshot.targetSignature, initial.snapshot.requirements.map(row => row.join(":")).join("|"), currency]);
  // Guard signatures use compact snapshots while the primary revision covers journal and budget writes.
  const guardValues = [
    env.DB.prepare(conditional.query).bind(...conditional.parameters),
    env.DB.prepare("INSERT INTO journal_entries(date,description,source) SELECT ?,?,'manual' WHERE ? > 0 RETURNING id,date,description,source,created_at").bind(source, input.description, transferRows.length),
  ];
  for (const chunk of chunkForD1InClause(transferRows, 20)) {
    const tuples = chunk.map(() => "((SELECT MAX(id) FROM journal_entries), ?, ?, ?, ?)").join(", ");
    guardValues.push(env.DB.prepare(`INSERT INTO journal_lines(journal_entry_id,account_id,debit,credit,currency) VALUES ${tuples}`).bind(...chunk.flatMap(row => [row.account_id, row.debit, row.credit, currency])));
  }
  for (const idChunk of chunkForD1InClause(completedRequirementIds)) {
    guardValues.push(env.DB.prepare(`UPDATE income_transfer_requirements SET transfer_journal_entry_id=CASE WHEN ?>0 THEN (SELECT MAX(id) FROM journal_entries) ELSE NULL END, completion_source='created', completed_at=? WHERE id IN (${idChunk.map(() => "?").join(",")}) AND completion_source IS NULL`).bind(transferRows.length, now, ...idChunk));
  }
  guardValues.push(...buildActualBalanceAdjustmentRefreshStatements(env.DB));
  try {
    const result = await runBudgetGuardedBatch(env.DB, initial.result.revision, guardValues);
    if (result === null) return { status: 409 as const, body: { error: "budget_placement_stale" } };
    const created = transferRows.length ? (result[1] as D1QueryResult<{id:number;date:string;description:string;source:"manual";created_at:string}>).results?.[0] ?? null : null;
    return { status: 200 as const, body: { transfer_journal_entry: created, requirement_ids: completedRequirementIds, unresolved_requirement_ids: [...unresolvedIds], transfers: preview.transfers } };
  } catch (error) {
    if (String(error).includes("stale_depreciation_budget_preview")) return { status: 409 as const, body: { error: "budget_placement_stale" } };
    throw error;
  }
}
