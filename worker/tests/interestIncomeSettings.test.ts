import { afterEach, describe, expect, test } from "bun:test";
import { budgetRouter } from "../src/routes/budget";
import { createTestD1 } from "./helpers/d1";

const fixtures: ReturnType<typeof createTestD1>[] = [];

function fixture() {
  const database = createTestD1();
  fixtures.push(database);
  database.sqlite.exec(`
    INSERT INTO enabled_currencies(code, decimal_places) VALUES
      ('JPY', 0), ('USD', 2);
    INSERT INTO accounts(id, name, type, category) VALUES
      (1001, 'Interest income', 'income', 'other'),
      (1002, 'Salary income', 'income', 'other'),
      (1003, 'Bank account', 'asset', 'cash');
    INSERT INTO budget_categories(id, name) VALUES
      (2001, 'Free spending'), (2002, 'Savings');
  `);
  return database;
}

function request(
  database: ReturnType<typeof createTestD1>,
  method: "GET" | "PATCH",
  body?: unknown,
) {
  return budgetRouter.request(
    "/settings",
    {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    { DB: database.DB },
  );
}

afterEach(() => {
  for (const database of fixtures.splice(0)) database.close();
});

describe("interest income budget settings", () => {
  test("defaults to disabled, persists normalized per-currency thresholds, and survives unrelated settings updates", async () => {
    const database = fixture();

    const initial = await request(database, "GET");
    expect(initial.status).toBe(200);
    expect(await initial.json()).toMatchObject({ interest_income_rule: null });

    const saved = await request(database, "PATCH", {
      interest_income_rule: {
        income_account_id: 1001,
        budget_category_id: 2001,
        transfer_thresholds: { jpy: 1000, usd: 0.25 },
      },
    });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({
      interest_income_rule: {
        income_account_id: 1001,
        budget_category_id: 2001,
        transfer_thresholds: { JPY: 1000, USD: 0.25 },
      },
    });

    const unrelatedUpdate = await request(database, "PATCH", {
      calendar_week_start: 1,
    });
    expect(unrelatedUpdate.status).toBe(200);
    expect(await unrelatedUpdate.json()).toMatchObject({
      calendar_week_start: 1,
      interest_income_rule: {
        income_account_id: 1001,
        budget_category_id: 2001,
        transfer_thresholds: { JPY: 1000, USD: 0.25 },
      },
    });

    const cleared = await request(database, "PATCH", {
      interest_income_rule: null,
    });
    expect(cleared.status).toBe(200);
    expect(await cleared.json()).toMatchObject({ interest_income_rule: null });
  });

  test("rejects missing or wrong-type references and invalid thresholds", async () => {
    const database = fixture();
    const invalidRules = [
      { income_account_id: 9999, budget_category_id: 2001, transfer_thresholds: {} },
      { income_account_id: 1003, budget_category_id: 2001, transfer_thresholds: {} },
      { income_account_id: 1001, budget_category_id: 9999, transfer_thresholds: {} },
      { income_account_id: 1001, budget_category_id: 2001, transfer_thresholds: { GBP: 1 } },
      { income_account_id: 1001, budget_category_id: 2001, transfer_thresholds: { JPY: -1 } },
      { income_account_id: 1001, budget_category_id: 2001, transfer_thresholds: { JPY: 0.5 } },
      { income_account_id: 1001, budget_category_id: 2001, transfer_thresholds: { USD: 0.001 } },
      { income_account_id: 1001.5, budget_category_id: 2001, transfer_thresholds: {} },
      { income_account_id: 1001, budget_category_id: 2001, transfer_thresholds: [] },
    ];

    for (const interest_income_rule of invalidRules) {
      const response = await request(database, "PATCH", { interest_income_rule });
      expect(response.status, JSON.stringify(interest_income_rule)).toBe(400);
    }
  });
});
