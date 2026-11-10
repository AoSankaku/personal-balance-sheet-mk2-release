import { expect, test } from "bun:test";
import { budgetRouter } from "../src/routes/budget";
import { createTestD1 } from "./helpers/d1";

function countSelects(DB: D1Database, onRead: () => void): D1Database {
  const wrapStatement = (statement: D1PreparedStatement, query: string): D1PreparedStatement =>
    new Proxy(statement, {
      get(target, property) {
        if (property === "bind") {
          return (...values: unknown[]) => wrapStatement(target.bind(...values), query);
        }
        if (property === "all" || property === "first" || property === "raw") {
          return (...args: unknown[]) => {
            if (/^\s*(?:SELECT|WITH)\b/i.test(query)) onRead();
            return Reflect.apply(target[property], target, args);
          };
        }
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });

  return new Proxy(DB, {
    get(target, property) {
      if (property === "prepare") return (query: string) => wrapStatement(target.prepare(query), query);
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

test("summary pair matches individual as-of/month-end summaries with fewer DB reads", async () => {
  const fixture = createTestD1();
  let reads = 0;
  const DB = countSelects(fixture.DB, () => reads++);
  fixture.sqlite.exec(`
    INSERT INTO budget_categories(id,name,sort_order) VALUES (1101,'JPY bucket',1),(1102,'USD bucket',2);
    INSERT INTO budget_allocations(budget_category_id,year_month,currency,fixed_amount) VALUES
      (1101,'2026-11','JPY',800),(1102,'2026-11','USD',10000);
    INSERT INTO enabled_currencies(code,custom_symbol,decimal_places) VALUES ('USD','$',2);
    INSERT INTO budget_adjustment_logs(budget_category_id,year_month,amount,currency,date,created_at,adjustment_type) VALUES
      (1101,'2026-11',1000,'JPY','2026-11-02','2026-11-02 09:00:00','allocation'),
      (1101,'2026-11',-400,'JPY','2026-11-10','2026-11-10 12:00:00','reset'),
      (1101,'2026-11',50,'JPY','2026-11-20','2026-11-20 09:00:00','transfer'),
      (1102,'2026-11',2000,'USD','2026-11-20','2026-11-20 09:00:00','allocation');
  `);
  const env = { DB };

  try {
    reads = 0;
    const todayResponse = await budgetRouter.request(
      "/summary?year_month=2026-11&as_of=2026-11-09&currency=JPY", {}, env,
    );
    const today = await todayResponse.json();
    const totalResponse = await budgetRouter.request(
      "/summary?year_month=2026-11&currency=JPY", {}, env,
    );
    const total = await totalResponse.json();
    const individualReads = reads;

    reads = 0;
    const pairResponse = await budgetRouter.request(
      "/summary-pair?year_month=2026-11&as_of=2026-11-09&currency=JPY", {}, env,
    );
    const pair = await pairResponse.json();

    expect(pairResponse.status).toBe(200);
    expect(pair).toEqual({ today, total });
    expect(pair.today.categories.some((row: { category: { id: number } }) => row.category.id === 1101)).toBe(true);
    expect(pair.today.categories.find((row: { category: { id: number } }) => row.category.id === 1102)?.available).toBe(0);
    expect(pair.today).not.toEqual(pair.total);
    expect(reads).toBeLessThan(individualReads);
    const usdToday = await budgetRouter.request("/summary?year_month=2026-11&as_of=2026-11-09&currency=USD", {}, env);
    const usdTotal = await budgetRouter.request("/summary?year_month=2026-11&currency=USD", {}, env);
    const usdPair = await budgetRouter.request("/summary-pair?year_month=2026-11&as_of=2026-11-09&currency=USD", {}, env);
    expect(usdPair.status).toBe(200);
    expect(await usdPair.json()).toEqual({ today: await usdToday.json(), total: await usdTotal.json() });
  } finally {
    fixture.close();
  }
});

test("summary pair preserves existing month-end fallback and validation behavior", async () => {
  const fixture = createTestD1();
  try {
    const invalidDate = await budgetRouter.request(
      "/summary-pair?year_month=2026-11&as_of=invalid", {}, { DB: fixture.DB },
    );
    expect(invalidDate.status).toBe(200);
    expect(await invalidDate.json()).toMatchObject({
      today: { year_month: "2026-11", currency: "JPY" },
      total: { year_month: "2026-11", currency: "JPY" },
    });
    for (const asOf of ["2026-10-31", "2026-12-01"]) {
      const response = await budgetRouter.request(`/summary-pair?year_month=2026-11&as_of=${asOf}`, {}, { DB: fixture.DB });
      expect(response.status).toBe(200);
      const pair = await response.json();
      expect(pair.today).toEqual(pair.total);
    }

    const invalidMonth = await budgetRouter.request("/summary-pair?year_month=2026/11", {}, { DB: fixture.DB });
    expect(invalidMonth.status).toBe(400);
    expect(await invalidMonth.json()).toEqual({ error: "year_month must be YYYY-MM" });
  } finally {
    fixture.close();
  }
});
