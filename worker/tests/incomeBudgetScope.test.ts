import { afterEach, describe, expect, test } from "bun:test";
import { journalRouter } from "../src/routes/journal";
import { budgetRouter } from "../src/routes/budget";
import { createIncomeBudgetScopeFixture } from "./helpers/incomeBudgetScopeFixture";
import { buildIncomeBudgetSubmissionFields } from "../../frontend/src/lib/incomeBudgetScope";

const fixtures: ReturnType<typeof createIncomeBudgetScopeFixture>[] = [];
afterEach(() => fixtures.splice(0).forEach((fixture) => fixture.close()));
function fixture() {
  const result = createIncomeBudgetScopeFixture();
  fixtures.push(result);
  return result;
}
function income(accountId: number, amount: number, allocated = amount) {
  return {
    date: "2026-10-20", description: "Gift card",
    lines: [{ account_id: accountId, debit: amount, credit: 0 }, { account_id: 1005, debit: 0, credit: amount }],
    income_budget_allocations: [{ budget_category_id: 1001, amount: allocated }],
  };
}
async function available(f: ReturnType<typeof fixture>) {
  const response = await budgetRouter.request("/summary?year_month=2026-10&as_of=2026-10-20&currency=JPY", {}, { DB: f.DB });
  expect(response.status).toBe(200);
  const summary = await response.json() as { categories: { category: { id: number }; available: number }[] };
  return summary.categories.find((row) => row.category.id === 1001)!.available;
}
function post(f: ReturnType<typeof fixture>, body: unknown, path = "/") {
  return journalRouter.request(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }, { DB: f.DB });
}

describe("income allocations inside the budget boundary", () => {
  test("a normal card income reduces debt and increases the selected budget without cash transfers", async () => {
    const f = fixture();
    const response = await post(f, income(1004, 1950));
    expect(response.status).toBe(201);
    expect(await available(f)).toBe(11950);
    expect(f.sqlite.query("SELECT SUM(credit-debit) AS balance FROM journal_lines WHERE account_id=1004").get()).toEqual({ balance: 3050 });
    expect(f.sqlite.query("SELECT COUNT(*) AS count FROM income_transfer_requirements").get()).toEqual({ count: 0 });
    expect(f.sqlite.query("SELECT SUM(debit-credit) AS balance FROM journal_lines WHERE account_id=1001").get()).toEqual({ balance: 100000 });
  });

  test("a bulk card purchase and discount consume only the net expense budget", async () => {
    const f = fixture();
    const response = await post(f, { entries: [
      { date: "2026-10-20", description: "Purchase", lines: [{ account_id: 1006, debit: 10000, credit: 0 }, { account_id: 1004, debit: 0, credit: 10000 }], budget_allocations: [{ budget_category_id: 1001, amount: -10000 }], budget_source: "simple" },
      income(1004, 2000),
    ] }, "/batch");
    expect(response.status).toBe(201);
    expect(await available(f)).toBe(2000);
    expect(f.sqlite.query("SELECT SUM(credit-debit) AS balance FROM journal_lines WHERE account_id=1004").get()).toEqual({ balance: 13000 });
    expect(f.sqlite.query("SELECT COUNT(*) AS count FROM income_transfer_requirements").get()).toEqual({ count: 0 });
  });

  test.each([1002, 1003])("API rejects explicit income allocation outside the budget boundary: %s", async (accountId) => {
    const f = fixture();
    expect((await post(f, income(accountId, 2000))).status).toBe(400);
    expect(await available(f)).toBe(10000);
    expect(f.sqlite.query("SELECT COUNT(*) AS count FROM journal_entries").get()).toEqual({ count: 1 });
  });

  test("rejects card income allocations greater than the debt reduction", async () => {
    const f = fixture();
    expect((await post(f, income(1004, 1950, 1951))).status).toBe(400);
    expect(await available(f)).toBe(10000);
  });

  async function incomeWithPendingTransfer(f: ReturnType<typeof fixture>) {
    const response = await post(f, {
      ...income(1001, 1000),
      income_transfer_destinations: [{ budget_category_id: 1001, from_account_id: 1001, to_account_id: 1007, amount: 1000, currency: "JPY" }],
    });
    expect(response.status).toBe(201);
    return (await response.json() as { id: number }).id;
  }

  function editedIncome(accountId: number) {
    const raw = income(accountId, 1000);
    return { ...raw, ...buildIncomeBudgetSubmissionFields({
      destinationAccount: { id: accountId, type: accountId === 1002 ? "asset" : "liability", category: accountId === 1002 ? "cash" : "credit_card", include_in_allocatable: accountId !== 1002, deduct_from_budget: accountId === 1004 },
      incomeBudgetAllocations: raw.income_budget_allocations,
      incomeTransferDestinations: [{ budget_category_id: 1001, from_account_id: 1001, to_account_id: 1007, amount: 1000, currency: "JPY" }],
    }) };
  }

  test.each([1004, 1003, 1002])("editing a cash income to non-cash/non-budget destination %s clears pending transfers", async (accountId) => {
    const f = fixture();
    const id = await incomeWithPendingTransfer(f);
    expect(f.sqlite.query("SELECT COUNT(*) AS count FROM income_transfer_requirements").get()).toEqual({ count: 1 });
    const response = await journalRouter.request(`/${id}`, {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(editedIncome(accountId)),
    }, { DB: f.DB });
    expect(response.status).toBe(200);
    expect(f.sqlite.query("SELECT COUNT(*) AS count FROM income_transfer_requirements").get()).toEqual({ count: 0 });
    expect(await available(f)).toBe(accountId === 1004 ? 11000 : 10000);
    expect(f.sqlite.query("SELECT SUM(debit-credit) AS balance FROM journal_lines WHERE account_id=1001").get()).toEqual({ balance: 100000 });
  });

  test("changing to card income preserves the completed-transfer conflict guard", async () => {
    const f = fixture();
    const id = await incomeWithPendingTransfer(f);
    f.sqlite.exec(`
      INSERT INTO journal_entries(id,date,description) VALUES(9001,'2026-10-20','Completed transfer');
      INSERT INTO journal_lines(journal_entry_id,account_id,debit,credit,currency) VALUES
        (9001,1001,0,1000,'JPY'),(9001,1007,1000,0,'JPY');
      UPDATE income_transfer_requirements SET completion_source='linked',transfer_journal_entry_id=9001,completed_at='2026-10-20 03:00:00';
    `);
    const response = await journalRouter.request(`/${id}`, {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(editedIncome(1004)),
    }, { DB: f.DB });
    expect(response.status).toBe(409);
    expect((await response.json() as { error: string }).error).toBe("income_transfer_completed_conflict");
    expect(f.sqlite.query("SELECT completion_source FROM income_transfer_requirements").get()).toEqual({ completion_source: "linked" });
    expect(await available(f)).toBe(11000);
  });
});
