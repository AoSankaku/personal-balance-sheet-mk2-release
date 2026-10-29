import { afterEach, describe, expect, test } from "bun:test";
import { journalRouter } from "../src/routes/journal";
import { createIncomeBudgetScopeFixture } from "./helpers/incomeBudgetScopeFixture";

const fixtures: ReturnType<typeof createIncomeBudgetScopeFixture>[] = [];

function fixture() {
  const database = createIncomeBudgetScopeFixture();
  fixtures.push(database);
  database.sqlite.exec(`
    INSERT INTO budget_filters(id, name, currency) VALUES
      (2001, 'Salary distribution', 'JPY'), (2002, 'Dollar distribution', 'USD');
  `);
  return database;
}

function income(overrides: Record<string, unknown> = {}) {
  return {
    date: "2026-10-20", description: "Regular salary",
    lines: [
      { account_id: 1001, debit: 1000, credit: 0 },
      { account_id: 1005, debit: 0, credit: 1000 },
    ],
    income_budget_allocations: [{ budget_category_id: 1001, amount: 750 }],
    is_regular_income: true,
    income_budget_filter_id: 2001,
    ...overrides,
  };
}

function request(database: ReturnType<typeof fixture>, method: string, path = "/", body?: unknown) {
  return journalRouter.request(path, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }, { DB: database.DB });
}

afterEach(() => {
  for (const database of fixtures.splice(0)) database.close();
});

describe("regular income editing", () => {
  test("persists the mode and selected filter through create, list, and detail", async () => {
    const database = fixture();
    const response = await request(database, "POST", "/", income());
    expect(response.status).toBe(201);
    const created = await response.json() as { id: number };
    expect(created).toMatchObject({ is_regular_income: true, income_budget_filter_id: 2001 });
    const detail = await request(database, "GET", `/${created.id}`);
    expect(await detail.json()).toMatchObject({ is_regular_income: true, income_budget_filter_id: 2001 });
    const list = await request(database, "GET");
    expect(await list.json()).toContainEqual(expect.objectContaining({ id: created.id, is_regular_income: true, income_budget_filter_id: 2001 }));
  });

  test("a date-only update retains the filter and exact saved allocation without applying it twice", async () => {
    const database = fixture();
    const created = await (await request(database, "POST", "/", income())).json() as { id: number };
    // An older client or the multi-line editor can omit the new metadata.
    const { is_regular_income: _mode, income_budget_filter_id: _filter, ...dateEdit } = income({ date: "2026-09-25" });
    const response = await request(database, "PUT", `/${created.id}`, dateEdit);
    expect(response.status).toBe(200);
    const detail = await (await request(database, "GET", `/${created.id}`)).json();
    expect(detail).toMatchObject({ date: "2026-09-25", is_regular_income: true, income_budget_filter_id: 2001 });
    expect(detail.income_budget_allocations).toEqual([
      expect.objectContaining({ budget_category_id: 1001, amount: 750 }),
    ]);
    expect(database.sqlite.query("SELECT COUNT(*) AS count, SUM(amount) AS amount FROM budget_adjustment_logs WHERE journal_entry_id = ?").get(created.id)).toEqual({ count: 1, amount: 750 });
  });

  test("explicitly turning off regular mode clears the filter while preserving manual allocation", async () => {
    const database = fixture();
    const created = await (await request(database, "POST", "/", income())).json() as { id: number };
    const response = await request(database, "PUT", `/${created.id}`, income({ is_regular_income: false, income_budget_filter_id: null }));
    expect(response.status).toBe(200);
    expect(await (await request(database, "GET", `/${created.id}`)).json()).toMatchObject({
      is_regular_income: false, income_budget_filter_id: null,
      income_budget_allocations: [expect.objectContaining({ amount: 750 })],
    });
  });

  test("does not infer regular mode from legacy manual allocations and supports batch creation", async () => {
    const database = fixture();
    const { is_regular_income: _mode, income_budget_filter_id: _filter, ...manual } = income();
    const response = await request(database, "POST", "/batch", { entries: [manual, income()] });
    expect(response.status).toBe(201);
    const created = await response.json();
    expect(created.entries[0]).toMatchObject({ is_regular_income: false, income_budget_filter_id: null });
    expect(created.entries[1]).toMatchObject({ is_regular_income: true, income_budget_filter_id: 2001 });
  });

  test("validates mode, filter references, and currency in create and update", async () => {
    const database = fixture();
    const created = await (await request(database, "POST", "/", income())).json() as { id: number };
    for (const change of [
      { is_regular_income: "true" },
      { is_regular_income: null },
      { income_budget_filter_id: "2001" },
      { income_budget_filter_id: 2001.5 },
      { income_budget_filter_id: 0 },
      { income_budget_filter_id: 9999 },
      { income_budget_filter_id: 2002 },
    ]) {
      expect((await request(database, "POST", "/", income(change))).status, JSON.stringify(change)).toBe(400);
      expect((await request(database, "PUT", `/${created.id}`, income(change))).status, JSON.stringify(change)).toBe(400);
    }
  });

  test("deleting a filter keeps regular mode and saved allocation readable", async () => {
    const database = fixture();
    const created = await (await request(database, "POST", "/", income())).json() as { id: number };
    database.sqlite.exec("DELETE FROM budget_filters WHERE id = 2001");
    expect(await (await request(database, "GET", `/${created.id}`)).json()).toMatchObject({
      is_regular_income: true, income_budget_filter_id: null,
      income_budget_allocations: [expect.objectContaining({ amount: 750 })],
    });
  });
});
