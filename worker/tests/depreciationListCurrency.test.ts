import { afterEach, expect, test } from "bun:test";
import { depreciationRouter } from "../src/routes/depreciation";
import { createTestD1 } from "./helpers/d1";

const databases: ReturnType<typeof createTestD1>[] = [];
afterEach(() => { for (const database of databases.splice(0)) database.close(); });

function fixture(options: { usdDecimalPlaces?: number } = {}) {
  const database = createTestD1();
  databases.push(database);
  database.sqlite.exec(`
    INSERT INTO enabled_currencies(code, decimal_places) VALUES ('JPY', 0), ('USD', 2);
    INSERT INTO accounts(id, name, type, category, is_depreciable) VALUES
      (1001, 'Cash', 'asset', 'cash', 0),
      (1002, 'Mattress', 'asset', 'property', 1),
      (1003, 'Depreciation expense', 'expense', 'other', 0);
    INSERT INTO budget_categories(id, name) VALUES (1001, 'Purchase'), (1002, 'Monthly source');
    INSERT INTO budget_category_accounts(budget_category_id, account_id, ratio) VALUES (1002, 1003, 100);
  `);
  if (options.usdDecimalPlaces !== undefined) {
    database.sqlite.query("UPDATE enabled_currencies SET decimal_places=? WHERE code='USD'")
      .run(options.usdDecimalPlaces);
  }
  return database;
}

async function request(database: ReturnType<typeof fixture>, method: "GET" | "POST", body?: unknown) {
  return depreciationRouter.request("/", {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }, { DB: database.DB });
}

test.each([
  { currency: "JPY", amount: 1234, monthly: 617 },
  { currency: "USD", amount: 12.34, monthly: 6.17 },
  { currency: "USD", amount: 1.23, monthly: 0.615, usdDecimalPlaces: 3 },
])("GET /api/depreciation returns $currency list amounts in user currency units", async ({ currency, amount, monthly, usdDecimalPlaces }) => {
  const database = fixture({ usdDecimalPlaces });
  const created = await request(database, "POST", {
    purchase_date: "2026-01-01",
    description: "Currency list test",
    asset_account_id: 1002,
    payment_account_id: 1001,
    expense_account_id: 1003,
    total_amount: amount,
    months: 2,
    currency,
    idempotency_key: crypto.randomUUID(),
    budget_settings: {
      method: "assigned",
      purchase_category_id: 1001,
      monthly_source_category_id: 1002,
    },
  });

  if (created.status !== 201) throw new Error(`Create failed (${created.status}): ${await created.text()}`);
  const response = await request(database, "GET");
  expect(response.status).toBe(200);
  const schedules = await response.json() as {
    total_amount: number;
    monthly_amounts: number[];
    budget: { target_amount: number };
  }[];

  expect(schedules).toHaveLength(1);
  expect(schedules[0]).toMatchObject({
    total_amount: amount,
    monthly_amounts: [monthly, monthly],
    budget: { target_amount: amount },
  });
  expect(schedules[0]!.monthly_amounts.reduce((sum, value) => sum + value, 0)).toBe(amount);
});

test("GET /api/depreciation keeps legacy JPY schedule amounts unchanged", async () => {
  const database = fixture();
  database.sqlite.exec(`
    INSERT INTO journal_entries(id, date, description, created_at) VALUES
      (1, '2026-01-01', 'Legacy purchase', '2026-01-01 09:00:00'),
      (2, '2026-01-01', 'Legacy month 1', '2026-01-01 09:00:00'),
      (3, '2026-02-01', 'Legacy month 2', '2026-02-01 09:00:00');
    INSERT INTO journal_lines(journal_entry_id, account_id, debit, credit, currency) VALUES
      (1, 1002, 1200, 0, 'JPY'), (1, 1001, 0, 1200, 'JPY'),
      (2, 1003, 600, 0, 'JPY'), (2, 1002, 0, 600, 'JPY'),
      (3, 1003, 600, 0, 'JPY'), (3, 1002, 0, 600, 'JPY');
    INSERT INTO depreciation_schedules(source_journal_entry_id, asset_account_id, expense_account_id, total_amount, months, start_date, description)
      VALUES (1, 1002, 1003, 1200, 2, '2026-01-01', 'Legacy mattress');
    INSERT INTO depreciation_entries(schedule_id, journal_entry_id, month_number)
      VALUES (1, 2, 1), (1, 3, 2);
  `);

  const response = await request(database, "GET");
  const schedules = await response.json() as { total_amount: number; monthly_amounts: number[] }[];
  expect(response.status).toBe(200);
  expect(schedules).toHaveLength(1);
  expect(schedules[0]).toMatchObject({ total_amount: 1200, monthly_amounts: [600, 600] });
});
