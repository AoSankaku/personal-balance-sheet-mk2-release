import { afterEach, describe, expect, test } from "bun:test";
import { budgetRouter } from "../src/routes/budget";
import { createTestD1 } from "./helpers/d1";

type BudgetLog = {
  id: number;
  budget_category_id: number;
  year_month: string;
  amount: number;
  currency: string;
  date: string;
  type: string;
  adjustment_type?: string;
};

function makeHarness() {
  const harness = createTestD1();
  const categoryId = Number(
    (harness.sqlite.query("SELECT id FROM budget_categories LIMIT 1").get() as
      | { id: number }
      | undefined)?.id ??
      harness.sqlite
        .query(
          "INSERT INTO budget_categories (name, sort_order, budget_group) VALUES ('Food', 0, 'daily') RETURNING id",
        )
        .get<{ id: number }>()!.id,
  );
  const env = { DB: harness.DB };

  return { ...harness, categoryId, env };
}

async function createAdjustment(
  env: { DB: D1Database },
  categoryId: number,
  date: string,
  amount: number,
  adjustmentType: "allocation" | "reset" = "allocation",
) {
  const response = await budgetRouter.request(
    "/allocations",
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        budget_category_id: categoryId,
        year_month: date.slice(0, 7),
        currency: "JPY",
        adhoc_delta: amount,
        date,
        adjustment_type: adjustmentType,
      }),
    },
    env,
  );
  expect(response.status).toBe(200);
  return (await response.json()) as BudgetLog;
}

async function listLogs(
  env: { DB: D1Database },
  query = "",
): Promise<BudgetLog[]> {
  const response = await budgetRouter.request(
    `/adjustment-logs?currency=JPY${query}`,
    {},
    env,
  );
  expect(response.status).toBe(200);
  return (await response.json()) as BudgetLog[];
}

describe("budget adjustment log API", () => {
  const harnesses: ReturnType<typeof makeHarness>[] = [];
  afterEach(() => {
    for (const harness of harnesses.splice(0)) harness.close();
  });

  test("replays reset amounts after backdated create, edit, delete, and date filtering", async () => {
    const harness = makeHarness();
    harnesses.push(harness);

    const opening = await createAdjustment(
      harness.env,
      harness.categoryId,
      "2026-01-01",
      100,
    );
    await createAdjustment(
      harness.env,
      harness.categoryId,
      "2026-01-10",
      999,
      "reset",
    );

    const resetBefore = (await listLogs(harness.env)).find(
      (log) => log.type === "reset",
    );
    expect(resetBefore?.amount).toBe(-100);

    const backdated = await createAdjustment(
      harness.env,
      harness.categoryId,
      "2026-01-05",
      25,
    );
    const afterCreate = (await listLogs(harness.env, "&from=2026-01-10")).find(
      (log) => log.type === "reset",
    );
    expect(afterCreate?.amount).toBe(-125);

    const editResponse = await budgetRouter.request(
      `/adjustment-logs/${backdated.id}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ amount: 40 }),
      },
      harness.env,
    );
    expect(editResponse.status).toBe(200);
    const afterEdit = (await listLogs(harness.env)).find(
      (log) => log.type === "reset",
    );
    expect(afterEdit?.amount).toBe(-140);

    const deleteResponse = await budgetRouter.request(
      `/adjustment-logs/${backdated.id}`,
      { method: "DELETE" },
      harness.env,
    );
    expect(deleteResponse.status).toBe(200);
    const afterDelete = (await listLogs(harness.env)).find(
      (log) => log.type === "reset",
    );
    expect(afterDelete?.amount).toBe(-100);

    expect(opening.amount).toBe(100);
    expect(
      harness.sqlite
        .query("SELECT COUNT(*) AS count FROM journal_entries")
        .get<{ count: number }>()?.count,
    ).toBe(0);
  });

  test("recomputes each reset from the balance since the preceding reset", async () => {
    const harness = makeHarness();
    harnesses.push(harness);

    await createAdjustment(
      harness.env,
      harness.categoryId,
      "2026-02-01",
      100,
    );
    await createAdjustment(
      harness.env,
      harness.categoryId,
      "2026-02-10",
      999,
      "reset",
    );
    await createAdjustment(
      harness.env,
      harness.categoryId,
      "2026-02-15",
      40,
    );
    await createAdjustment(
      harness.env,
      harness.categoryId,
      "2026-02-20",
      999,
      "reset",
    );

    const resets = (await listLogs(harness.env)).filter(
      (log) => log.type === "reset",
    );
    expect(resets.map((log) => log.amount)).toEqual([-40, -100]);
  });

  test("ordinary reference allocations are visible but do not spend or reserve a budget", async () => {
    const harness = makeHarness();
    harnesses.push(harness);
    const accountIds = harness.sqlite
      .query(
        "INSERT INTO accounts (name, type, category) VALUES ('Cash', 'asset', 'cash'), ('Food expense', 'expense', 'expense') RETURNING id",
      )
      .all<{ id: number }>()
      .map((row) => row.id);
    const entryId = Number(
      harness.sqlite
        .query(
          "INSERT INTO journal_entries (date, description) VALUES ('2026-03-03', 'Reference') RETURNING id",
        )
        .get<{ id: number }>()!.id,
    );
    harness.sqlite
      .query(
        "INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit, currency) VALUES (?, ?, 100, 0, 'JPY'), (?, ?, 0, 100, 'JPY')",
      )
      .run(entryId, accountIds[1]!, entryId, accountIds[0]!);
    harness.sqlite
      .query(
        "INSERT INTO journal_entry_budget_allocations (journal_entry_id, budget_category_id, amount, currency, source, is_reference) VALUES (?, ?, -100, 'JPY', 'simple', 1)",
      )
      .run(entryId, harness.categoryId);

    const beforeAssets = harness.sqlite
      .query(
        "SELECT COALESCE(SUM(debit - credit), 0) AS balance FROM journal_lines WHERE account_id = ?",
      )
      .get<{ balance: number }>(accountIds[0]! )?.balance;
    const summaryResponse = await budgetRouter.request(
      "/summary?year_month=2026-03&currency=JPY",
      {},
      harness.env,
    );
    expect(summaryResponse.status).toBe(200);
    const summary = (await summaryResponse.json()) as {
      total_budget: number;
      total_available: number;
      total_reference_spent: number;
      total_reference_reserve: number;
      categories: {
        spent: number;
        available: number;
        reference_spent: number;
        reference_reserve: number;
      }[];
    };

    expect(summary.categories[0]?.spent).toBe(0);
    expect(summary.categories[0]?.reference_spent).toBe(100);
    expect(summary.categories[0]?.reference_reserve).toBe(0);
    expect(summary.total_budget).toBe(0);
    expect(summary.total_available).toBe(0);
    expect(summary.total_reference_spent).toBe(100);
    expect(summary.total_reference_reserve).toBe(0);
    expect(
      harness.sqlite
        .query(
          "SELECT COALESCE(SUM(debit - credit), 0) AS balance FROM journal_lines WHERE account_id = ?",
        )
        .get<{ balance: number }>(accountIds[0]! )?.balance,
    ).toBe(beforeAssets);
  });

  test("rejects invalid dates and derived reset amounts while allowing reset metadata edits", async () => {
    const harness = makeHarness();
    harnesses.push(harness);
    const allocation = await createAdjustment(
      harness.env,
      harness.categoryId,
      "2026-01-15",
      100,
    );
    const reset = await createAdjustment(
      harness.env,
      harness.categoryId,
      "2026-01-20",
      999,
      "reset",
    );

    const invalidDate = await budgetRouter.request(
      `/adjustment-logs/${allocation.id}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ date: "2026-02-30" }),
      },
      harness.env,
    );
    expect(invalidDate.status).toBe(400);

    const moveMonth = await budgetRouter.request(
      `/adjustment-logs/${allocation.id}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ date: "2026-02-01", amount: 120 }),
      },
      harness.env,
    );
    expect(moveMonth.status).toBe(200);
    expect(await moveMonth.json()).toMatchObject({
      date: "2026-02-01",
      year_month: "2026-02",
      amount: 120,
    });

    const rejectDerivedAmount = await budgetRouter.request(
      `/adjustment-logs/${reset.id}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ amount: -50 }),
      },
      harness.env,
    );
    expect(rejectDerivedAmount.status).toBe(400);

    const updateResetMetadata = await budgetRouter.request(
      `/adjustment-logs/${reset.id}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ date: "2026-02-05", note: "reconciled" }),
      },
      harness.env,
    );
    expect(updateResetMetadata.status).toBe(200);
    expect(await updateResetMetadata.json()).toMatchObject({
      date: "2026-02-05",
      year_month: "2026-02",
      note: "reconciled",
    });
  });
});
