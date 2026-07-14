import { describe, expect, test } from "bun:test";
import { budgetRouter } from "../src/routes/budget";
import { depreciationRouter } from "../src/routes/depreciation";
import { journalRouter } from "../src/routes/journal";
import { longTermLoanPlansRouter } from "../src/routes/longTermLoanPlans";
import { trialBalanceRouter } from "../src/routes/trialBalance";

const env = { DB: {} as D1Database };

async function postJson(
  router: { request: HonoRequest },
  path: string,
  body: unknown,
) {
  return router.request(
    path,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
    env,
  );
}

async function patchJson(
  router: { request: HonoRequest },
  path: string,
  body: unknown,
) {
  return router.request(
    path,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
    env,
  );
}

type HonoRequest = (
  input: string,
  requestInit?: RequestInit,
  env?: unknown,
) => Response | Promise<Response>;

describe("money validation at API boundaries", () => {
  test("rejects invalid budget history query before DB reads", async () => {
    const invalidFormat = await budgetRouter.request(
      "/history?from=2026-5&to=2026-06",
      {},
      env,
    );
    expect(invalidFormat.status).toBe(400);
    expect(await invalidFormat.json()).toMatchObject({
      error: "from and to must be YYYY-MM",
    });

    const reversedRange = await budgetRouter.request(
      "/history?from=2026-07&to=2026-06",
      {},
      env,
    );
    expect(reversedRange.status).toBe(400);
    expect(await reversedRange.json()).toMatchObject({
      error: "from must be before or equal to to",
    });
  });

  test("rejects fractional journal line amounts before DB writes", async () => {
    const response = await postJson(journalRouter, "/", {
      date: "2026-05-07",
      description: "fractional",
      lines: [
        { account_id: 1, debit: 100.5, credit: 0 },
        { account_id: 2, debit: 0, credit: 100.5 },
      ],
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: "invalid_money_amount",
      field: "lines[0].debit",
    });
  });

  test("allows decimal currencies only up to their configured precision", async () => {
    const response = await postJson(journalRouter, "/", {
      date: "2026-05-07",
      description: "fractional usd",
      lines: [
        { account_id: 1, debit: 12.345, credit: 0, currency: "USD" },
        { account_id: 2, debit: 0, credit: 12.345, currency: "USD" },
      ],
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: "invalid_money_amount",
      field: "lines[0].debit",
      currency: "USD",
    });
  });

  test("rejects fractional budget allocation amounts before DB writes", async () => {
    const response = await postJson(budgetRouter, "/allocations", {
      budget_category_id: 1,
      year_month: "2026-05",
      fixed_amount: 100.5,
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: "invalid_money_amount",
      field: "fixed_amount",
    });
  });

  test("rejects fractional actual balance amounts before DB writes", async () => {
    const response = await postJson(trialBalanceRouter, "/snapshots", {
      snapshot_date: "2026-05-07",
      general_entries: [{ account_id: 1, amount: 1.25 }],
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: "invalid_money_amount",
      field: "general_entries[0].amount",
    });
  });

  test("rejects a fractional confirmed CSV card balance before DB writes", async () => {
    const response = await patchJson(trialBalanceRouter, "/credit-card-state", {
      account_id: 1,
      payment_month: "2026-07",
      amount: 1.25,
      status: "confirmed",
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: "invalid_money_amount",
      field: "amount",
    });
  });

  test("rejects fractional long-term loan plan amounts before DB writes", async () => {
    const response = await postJson(longTermLoanPlansRouter, "/", {
      account_id: 1,
      currency: "JPY",
      total_principal: 1000.1,
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: "invalid_money_amount",
      field: "total_principal",
    });
  });

  test("rejects fractional depreciation amounts before DB writes", async () => {
    const response = await postJson(depreciationRouter, "/", {
      purchase_date: "2026-05-07",
      description: "asset",
      asset_account_id: 1,
      payment_account_id: 2,
      expense_account_id: 3,
      total_amount: 500.5,
      months: 12,
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: "invalid_money_amount",
      field: "total_amount",
    });
  });
});
