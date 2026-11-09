import { afterEach, expect, test } from "bun:test";
import type { BudgetSummary, JournalEntry } from "@balance-sheet/shared";
import { journalRouter } from "../src/routes/journal";
import { budgetRouter } from "../src/routes/budget";
import { createIncomeBudgetScopeFixture } from "./helpers/incomeBudgetScopeFixture";
import { buildTransferBudgetAdjustments, getTransferBudgetCategoryOptions } from "../../frontend/src/lib/transferBudgetMovement";

const fixtures: ReturnType<typeof createIncomeBudgetScopeFixture>[] = [];
afterEach(() => fixtures.splice(0).forEach((fixture) => fixture.close()));

test.each([true, false])("card-to-excluded-cash transfers save and edit with optional budget movement: %s", async (useBudget) => {
  const fixture = createIncomeBudgetScopeFixture();
  fixtures.push(fixture);
  const options = getTransferBudgetCategoryOptions({
    budgetCategories: [{ id: 1001, name: "Daily budget", target_accounts: [{ account_id: 1007, ratio: 100 }] }],
    accounts: [{ id: 1004, type: "liability", category: "credit_card" }, { id: 1002, type: "asset", category: "cash" }],
    fromAccountId: 1004,
    toAccountId: 1002,
  });
  expect(options.sourceOptions).toEqual([{ value: "1001", label: "Daily budget" }]);
  expect(options.destinationOptions).toEqual([]);
  const selectedCategoryId = useBudget ? Number(options.sourceOptions[0]!.value) : null;
  const body = (amount: number) => ({
    date: "2026-10-20",
    description: "Card-funded excluded cash",
    lines: [
      { account_id: 1002, debit: amount, credit: 0, currency: "JPY" },
      { account_id: 1004, debit: 0, credit: amount, currency: "JPY", credit_card_billing_offset_months: 2 },
    ],
    income_budget_allocations: buildTransferBudgetAdjustments({
      amount,
      sourceBudgetCategoryId: selectedCategoryId,
      destinationBudgetCategoryId: null,
    }),
  });
  async function verify(id: number, amount: number) {
    const response = await journalRouter.request(`/${id}`, {}, { DB: fixture.DB });
    expect(response.status).toBe(200);
    const entry = await response.json() as JournalEntry;
    expect(entry.lines.find((line) => line.account_id === 1004)).toMatchObject({ credit: amount, credit_card_billing_offset_months: 2 });
    expect(entry.income_budget_allocations ?? []).toEqual(useBudget
      ? [expect.objectContaining({ budget_category_id: 1001, amount: -amount, adjustment_type: "transfer" })]
      : []);
    expect(entry.budget_allocations ?? []).toEqual([]);
    const summaryResponse = await budgetRouter.request("/summary?year_month=2026-10&as_of=2026-10-20&currency=JPY", {}, { DB: fixture.DB });
    expect(summaryResponse.status).toBe(200);
    const summary = await summaryResponse.json() as BudgetSummary;
    expect(summary.categories.find((category) => category.category.id === 1001)!.available).toBe(10_000 - (useBudget ? amount : 0));
    expect(fixture.sqlite.query("SELECT SUM(credit-debit) AS amount FROM journal_lines WHERE account_id=1004").get()).toEqual({ amount: 5_000 + amount });
    expect(fixture.sqlite.query("SELECT SUM(debit-credit) AS amount FROM journal_lines WHERE account_id=1002").get()).toEqual({ amount });
    expect(fixture.sqlite.query("SELECT COUNT(*) AS count FROM budget_adjustment_logs WHERE journal_entry_id=?").get(id)).toEqual({ count: useBudget ? 1 : 0 });
  }
  const createdResponse = await journalRouter.request("/", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body(750)),
  }, { DB: fixture.DB });
  expect(createdResponse.status).toBe(201);
  const { id } = await createdResponse.json() as JournalEntry;
  await verify(id, 750);
  const editedResponse = await journalRouter.request(`/${id}`, {
    method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body(400)),
  }, { DB: fixture.DB });
  expect(editedResponse.status).toBe(200);
  await verify(id, 400);
});
