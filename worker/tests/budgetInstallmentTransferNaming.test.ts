import { afterEach, expect, test } from "bun:test";
import { depreciationRouter } from "../src/routes/depreciation";
import { createTestD1 } from "./helpers/d1";

const fixtures: ReturnType<typeof createTestD1>[] = [];
afterEach(() => { for (const fixture of fixtures.splice(0)) fixture.close(); });

test("new installment transfer entries and special budgets use the expense-spreading feature name", async () => {
  const fixture = createTestD1();
  fixtures.push(fixture);
  fixture.sqlite.exec(`
    INSERT INTO accounts(id,name,type,category,is_depreciable) VALUES
      (1001,'Bank','asset','cash',0),(1002,'Equipment','asset','property',1),
      (1003,'Expense','expense','other',0);
    INSERT INTO budget_categories(id,name) VALUES(1001,'Living');
  `);
  const response = await depreciationRouter.request("/", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      purchase_date: "2026-01-01", description: "Laptop", asset_account_id: 1002,
      payment_account_id: 1001, expense_account_id: 1003, total_amount: 12, months: 2,
      currency: "JPY", idempotency_key: "budget-installment-naming",
      budget_settings: { method: "special", monthly_source_category_id: 1001 },
    }),
  }, { DB: fixture.DB });
  expect(response.status).toBe(201);
  const { schedule_id: scheduleId } = await response.json() as { schedule_id: number };
  const descriptions = fixture.sqlite.query(`SELECT j.description FROM journal_entries j
    JOIN depreciation_entries e ON e.journal_entry_id=j.id WHERE e.schedule_id=?`).all(scheduleId) as { description: string }[];
  expect(descriptions).toHaveLength(2);
  for (const row of descriptions) {
    expect(row.description).toContain("予算分割振替");
    expect(row.description).not.toContain("減価償却");
  }
  const category = fixture.sqlite.query(`SELECT c.name,c.budget_group FROM budget_categories c
    JOIN depreciation_schedules s ON s.budget_special_category_id=c.id WHERE s.id=?`).get(scheduleId) as { name: string; budget_group: string };
  expect(category.name).toContain("予算分割振替");
  expect(category.budget_group).toBe("予算分割振替");
});
