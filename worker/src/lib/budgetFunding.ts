import {
  findLatestResetPointForPeriod,
  isAfterBudgetResetPoint,
  type BudgetAdjustmentLogForPeriod,
  type BudgetResetPoint,
  type DateRange,
} from "./budgetSummary";

export type BudgetFundingKind = "borrow" | "repay" | "lend" | "collect";

export interface BudgetFundingTimelineRow {
  journal_entry_id: number;
  budget_category_id: number | null;
  kind: BudgetFundingKind;
  amount: number;
  date: string;
  created_at?: string | null;
  source_date?: string | null;
  source_created_at?: string | null;
}

export interface BudgetFundingPeriodSummary {
  net: number;
  borrowed: number;
  lent: number;
}

function resetBeforeEvent(
  rows: BudgetAdjustmentLogForPeriod[],
  budgetCategoryId: number,
  event: { date: string; created_at?: string | null },
): BudgetResetPoint | null {
  const points = rows
    .filter(
      (row) =>
        row.budget_category_id === budgetCategoryId &&
        row.adjustment_type === "reset" &&
        isAfterBudgetResetPoint(event, {
          date: row.date,
          created_at: row.created_at ?? null,
        }),
    )
    .map((row) => ({
      date: row.date,
      created_at: row.created_at ?? null,
    }))
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        (a.created_at ?? "").localeCompare(b.created_at ?? ""),
    );
  return points.at(-1) ?? null;
}

function emptySummary(): BudgetFundingPeriodSummary {
  return { net: 0, borrowed: 0, lent: 0 };
}

export function sumBudgetFundingAfterResetsByPeriod(
  fundingRows: BudgetFundingTimelineRow[],
  budgetRows: BudgetAdjustmentLogForPeriod[],
  dateRangesByYearMonth: Map<string, DateRange>,
): Map<string, BudgetFundingPeriodSummary> {
  const result = new Map<string, BudgetFundingPeriodSummary>();

  for (const row of fundingRows) {
    if (row.budget_category_id == null || row.amount <= 0) continue;
    const yearMonth = row.date.slice(0, 7);
    const range = dateRangesByYearMonth.get(yearMonth);
    if (!range || row.date < range.start || row.date > range.end) continue;

    const periodReset = findLatestResetPointForPeriod(
      budgetRows,
      row.budget_category_id,
      range,
    );
    if (!isAfterBudgetResetPoint(row, periodReset)) continue;

    if (row.source_date) {
      const reset = resetBeforeEvent(
        budgetRows,
        row.budget_category_id,
        row,
      );
      if (
        reset &&
        !isAfterBudgetResetPoint(
          {
            date: row.source_date,
            created_at: row.source_created_at ?? null,
          },
          reset,
        )
      ) {
        continue;
      }
    }

    const key = `${row.budget_category_id}:${yearMonth}`;
    const summary = result.get(key) ?? emptySummary();
    if (row.kind === "borrow") {
      summary.net += row.amount;
      summary.borrowed += row.amount;
    } else if (row.kind === "repay") {
      summary.net -= row.amount;
      summary.borrowed -= row.amount;
    } else if (row.kind === "lend") {
      summary.net -= row.amount;
      summary.lent += row.amount;
    } else {
      summary.net += row.amount;
      summary.lent -= row.amount;
    }
    result.set(key, summary);
  }

  return result;
}
