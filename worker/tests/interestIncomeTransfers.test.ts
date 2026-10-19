import { afterEach, expect, test } from "bun:test";
import type { Account, IncomeTransferRequirementGroup, JournalEntry } from "@balance-sheet/shared";
import { journalRouter } from "../src/routes/journal";
import { incomeTransferRequirementsRouter } from "../src/routes/incomeTransferRequirements";
import { budgetRouter } from "../src/routes/budget";
import { createIncomeBudgetScopeFixture } from "./helpers/incomeBudgetScopeFixture";
import { buildInterestIncomeDefault, partitionInterestIncomeTransfers } from "../../frontend/src/lib/interestIncome";

const fixtures: ReturnType<typeof createIncomeBudgetScopeFixture>[] = [];
afterEach(() => fixtures.splice(0).forEach(f => f.close()));

test("interest is budgeted immediately, stays pending when deferred, and uses the existing net transfer completion", async () => {
  const f = createIncomeBudgetScopeFixture();
  fixtures.push(f);
  const rule = { income_account_id: 1005, budget_category_id: 1001, transfer_thresholds: { JPY: 1000 } };
  for (const amount of [112, 122]) {
    const response = await journalRouter.request("/", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
      date: "2026-10-20", description: "Deposit interest",
      lines: [{ account_id: 1001, debit: amount, credit: 0 }, { account_id: 1005, debit: 0, credit: amount }],
      income_budget_allocations: buildInterestIncomeDefault({ rule, incomeAccountId: 1005, amount, categories: [{ id: 1001, name: "Free spending" }] }),
      income_transfer_destinations: [{ budget_category_id: 1001, from_account_id: 1001, to_account_id: 1007, amount, currency: "JPY" }],
    }) }, { DB: f.DB });
    expect(response.status).toBe(201);
  }
  const journal = await (await journalRouter.request("/", {}, { DB: f.DB })).json() as JournalEntry[];
  const { groups } = await (await incomeTransferRequirementsRouter.request("/?status=pending", {}, { DB: f.DB })).json() as { groups: IncomeTransferRequirementGroup[] };
  const partition = partitionInterestIncomeTransfers({ groups, journal, rule, accounts: [{ id: 1005, type: "income" }] as Account[] });
  expect(partition.deferred).toHaveLength(2);
  expect(partition.actionable).toHaveLength(0);
  expect(f.sqlite.query("SELECT SUM(debit-credit) AS balance FROM journal_lines WHERE account_id=1001").get()).toEqual({ balance: 100234 });
  expect(f.sqlite.query("SELECT COUNT(*) AS count FROM journal_lines WHERE account_id=1007").get()).toEqual({ count: 0 });
  expect(f.sqlite.query("SELECT COUNT(*) AS count FROM income_transfer_requirements WHERE completion_source IS NULL").get()).toEqual({ count: 2 });
  const summary = await (await budgetRouter.request("/summary?year_month=2026-10&as_of=2026-10-20&currency=JPY", {}, { DB: f.DB })).json() as { categories: { available: number }[] };
  expect(summary.categories[0].available).toBe(10234);
  const preview = await (await incomeTransferRequirementsRouter.request("/squash-preview", {}, { DB: f.DB })).json() as { transfers: { amount: number }[] };
  expect(preview.transfers.map(t => t.amount)).toEqual([234]);
  const complete = await incomeTransferRequirementsRouter.request("/squash", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ description: "Actual consolidated transfer" }) }, { DB: f.DB });
  expect(complete.status).toBe(200);
  expect(f.sqlite.query("SELECT SUM(debit-credit) AS balance FROM journal_lines WHERE account_id=1007").get()).toEqual({ balance: 234 });
  expect(f.sqlite.query("SELECT COUNT(*) AS count FROM income_transfer_requirements WHERE completion_source IS NULL").get()).toEqual({ count: 0 });
  expect(f.sqlite.query("SELECT SUM(amount) AS amount FROM budget_adjustment_logs WHERE journal_entry_id IS NOT NULL").get()).toEqual({ amount: 234 });
});
