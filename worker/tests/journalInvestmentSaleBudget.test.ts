import { afterEach, describe, expect, test } from "bun:test";
import { journalRouter } from "../src/routes/journal";
import { budgetRouter } from "../src/routes/budget";
import { createIncomeBudgetScopeFixture } from "./helpers/incomeBudgetScopeFixture";

const fixtures: ReturnType<typeof createIncomeBudgetScopeFixture>[] = [];
afterEach(() => fixtures.splice(0).forEach(fixture => fixture.close()));
function fixture() {
  const result = createIncomeBudgetScopeFixture();
  fixtures.push(result);
  return result;
}
const saleLines = [
  { account_id: 1001, debit: 120_000, credit: 0, currency: "JPY" },
  { account_id: 1009, debit: 0, credit: 100_000, currency: "JPY" },
  { account_id: 1005, debit: 0, credit: 20_000, currency: "JPY" },
];
const fullAllocation = [
  { budget_category_id: 1001, amount: 20_000 },
  { budget_category_id: 1001, amount: 100_000, adjustment_type: "transfer" },
];
function post(f: ReturnType<typeof fixture>, body: unknown) {
  return journalRouter.request("/", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }, { DB: f.DB });
}
async function available(f: ReturnType<typeof fixture>) {
  const response = await budgetRouter.request("/summary?year_month=2026-10&as_of=2026-10-20&currency=JPY", {}, { DB: f.DB });
  const summary = await response.json() as { categories: { category: { id: number }; available: number }[] };
  return summary.categories.find(row => row.category.id === 1001)!.available;
}

describe("compound investment-sale budget allocations", () => {
  test("allocates sale gain and returned principal separately, then preserves them on edit", async () => {
    const f = fixture();
    const created = await post(f, {
      date: "2026-10-20", description: "Investment sale", lines: saleLines,
      budget_allocations: [], income_budget_allocations: fullAllocation,
    });
    expect(created.status).toBe(201);
    const response = await created.json() as { id: number };
    expect(await available(f)).toBe(130_000);
    expect(f.sqlite.query("SELECT COUNT(*) AS count FROM journal_entry_budget_allocations WHERE journal_entry_id=?").get(response.id)).toEqual({ count: 0 });

    const edited = await journalRouter.request(`/${response.id}`, {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        date: "2026-10-20", description: "Investment sale", lines: saleLines,
        budget_source: "multiline", budget_allocations: [], income_budget_allocations: fullAllocation,
        income_transfer_destinations: [],
      }),
    }, { DB: f.DB });
    expect(edited.status).toBe(200);
    expect(await available(f)).toBe(130_000);
    const rows = f.sqlite.query("SELECT adjustment_type, amount FROM budget_adjustment_logs WHERE journal_entry_id=? ORDER BY adjustment_type").all(response.id);
    expect(rows).toEqual([
      { adjustment_type: "allocation", amount: 20_000 },
      { adjustment_type: "transfer", amount: 100_000 },
    ]);
  });

  test("accepts transfer tasks for proceeds and rejects unsupported source, category, and amount", async () => {
    const f = fixture();
    const valid = await post(f, {
      date: "2026-10-20", description: "Investment sale", lines: saleLines,
      income_budget_allocations: fullAllocation,
      income_transfer_destinations: [{ budget_category_id: 1001, from_account_id: 1001, to_account_id: 1007, amount: 120_000, currency: "JPY" }],
    });
    expect(valid.status).toBe(201, JSON.stringify(await valid.clone().json()));

    for (const task of [
      { budget_category_id: 1001, from_account_id: 1007, to_account_id: 1001, amount: 1 },
      { budget_category_id: 1001, from_account_id: 1001, to_account_id: 1007, amount: 120_001 },
      { budget_category_id: 1006, from_account_id: 1001, to_account_id: 1007, amount: 1 },
    ]) {
      const response = await post(f, {
        date: "2026-10-20", description: "Invalid investment sale", lines: saleLines,
        income_budget_allocations: fullAllocation,
        income_transfer_destinations: [{ ...task, currency: "JPY" }],
      });
      expect(response.status).toBe(400);
    }
  });

  test("accepts a full sale allocation split across multiple actual receipt accounts", async () => {
    const f = fixture();
    f.sqlite.query("INSERT INTO accounts(id,name,type,category,include_in_allocatable,deduct_from_budget) VALUES(1013,'Third bank','asset','cash',1,0)").run();
    const response = await post(f, {
      date: "2026-10-20", description: "Investment sale to two banks", lines: [
        { account_id: 1001, debit: 60_000, credit: 0, currency: "JPY" },
        { account_id: 1007, debit: 60_000, credit: 0, currency: "JPY" },
        { account_id: 1009, debit: 0, credit: 100_000, currency: "JPY" },
        { account_id: 1005, debit: 0, credit: 20_000, currency: "JPY" },
      ],
      income_budget_allocations: fullAllocation,
      income_transfer_destinations: [
        { budget_category_id: 1001, from_account_id: 1001, to_account_id: 1013, amount: 60_000, currency: "JPY" },
        { budget_category_id: 1001, from_account_id: 1007, to_account_id: 1013, amount: 60_000, currency: "JPY" },
      ],
    });
    expect(response.status).toBe(201, JSON.stringify(await response.clone().json()));
  });

  test("rejects principal allocations beyond the sold holding and keeps ordinary income limits", async () => {
    const f = fixture();
    const tooMuchPrincipal = await post(f, {
      date: "2026-10-20", description: "Over-allocated sale", lines: saleLines,
      income_budget_allocations: [
        { budget_category_id: 1001, amount: 20_000 },
        { budget_category_id: 1001, amount: 100_001, adjustment_type: "transfer" },
      ],
    });
    expect(tooMuchPrincipal.status).toBe(400);
    expect((await post(f, {
      date: "2026-10-20", description: "Normal income", lines: [
        { account_id: 1001, debit: 2_000, credit: 0 },
        { account_id: 1005, debit: 0, credit: 2_000 },
      ], income_budget_allocations: [{ budget_category_id: 1001, amount: 2_001 }],
    })).status).toBe(400);
  });
});
