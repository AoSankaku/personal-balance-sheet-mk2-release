import { afterEach, describe, expect, test } from "bun:test";
import { budgetRouter } from "../src/routes/budget";
import { createTestD1 } from "./helpers/d1";

type Adjustment = { budget_category_id: number; adhoc_delta: number };
type Preview = {
  date: string;
  currency: string;
  adjustment_total: number;
  categories: { budget_category_id: number; before_available: number; after_available: number }[];
  allocatable_before: number;
  allocatable_after: number;
  token: string;
};

const harnesses: ReturnType<typeof createTestD1>[] = [];
afterEach(() => {
  for (const harness of harnesses.splice(0)) harness.close();
});

function fixture() {
  const harness = createTestD1();
  harnesses.push(harness);
  harness.sqlite.exec(`
    INSERT INTO enabled_currencies(code, decimal_places) VALUES ('JPY', 0), ('USD', 2);
    INSERT INTO accounts(id,name,type,category,include_in_allocatable) VALUES
      (101,'Bank','asset','cash',1),(102,'Opening balance','equity','opening_balance',1);
    INSERT INTO journal_entries(id,date,description,created_at) VALUES
      (101,'2026-01-01','Opening balance','2026-01-01 00:00:00');
    INSERT INTO journal_lines(journal_entry_id,account_id,debit,credit,currency) VALUES
      (101,101,50000,0,'JPY'),(101,102,0,50000,'JPY');
  `);
  return harness;
}

function addCategory(
  harness: ReturnType<typeof fixture>,
  name: string,
  values: { sort_order?: number; balance_cap?: number; overflow_budget_category_id?: number; is_archived?: number } = {},
) {
  const result = harness.sqlite.query(`
    INSERT INTO budget_categories(name,sort_order,balance_cap,overflow_budget_category_id,is_archived)
    VALUES (?, ?, ?, ?, ?) RETURNING id
  `).get<{ id: number }>(name, values.sort_order ?? 0, values.balance_cap ?? null,
    values.overflow_budget_category_id ?? null, values.is_archived ?? 0);
  return Number(result!.id);
}

function addLog(
  harness: ReturnType<typeof fixture>,
  categoryId: number,
  amount: number,
  date: string,
  currency = "JPY",
  type = "allocation",
  createdAt = `${date} 09:00:00`,
) {
  harness.sqlite.query(`
    INSERT INTO budget_adjustment_logs(budget_category_id,year_month,amount,currency,date,adjustment_type,created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(categoryId, date.slice(0, 7), amount, currency, date, type, createdAt);
}

function request(harness: ReturnType<typeof fixture>, path: string, body: unknown) {
  return budgetRouter.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }, { DB: harness.DB });
}

function previewBody(date: string, currency: string, adjustments: Adjustment[], note?: string | null) {
  return { date, currency, note, adjustments };
}

describe("budget adjustment batch API", () => {
  test("previews every category, computes allocatable balances, and saves all selected deltas together", async () => {
    const harness = fixture();
    const a = addCategory(harness, "A", { sort_order: 0 });
    const b = addCategory(harness, "B", { sort_order: 1 });
    const untouched = addCategory(harness, "Untouched", { sort_order: 2 });
    addLog(harness, a, 20_000, "2026-01-01");
    addLog(harness, b, 10_000, "2026-01-01");
    const initialCount = harness.sqlite.query("SELECT COUNT(*) AS n FROM budget_adjustment_logs").get<{ n: number }>()!.n;
    const adjustments = [{ budget_category_id: a, adhoc_delta: -10_000 }, { budget_category_id: b, adhoc_delta: 8_000 }];

    const response = await request(harness, "/allocations/preview", previewBody("2026-01-31", "JPY", adjustments, "  Trip  "));
    expect(response.status).toBe(200);
    const preview = await response.json() as Preview;
    expect(preview.adjustment_total).toBe(-2_000);
    expect(preview.categories).toEqual([
      { budget_category_id: a, before_available: 20_000, after_available: 10_000 },
      { budget_category_id: b, before_available: 10_000, after_available: 18_000 },
      { budget_category_id: untouched, before_available: 0, after_available: 0 },
    ]);
    expect(preview.allocatable_before).toBe(20_000);
    expect(preview.allocatable_after).toBe(22_000);
    expect(preview.token).toBeTruthy();
    expect(harness.sqlite.query("SELECT COUNT(*) AS n FROM budget_adjustment_logs").get<{ n: number }>()!.n).toBe(initialCount);

    const saved = await request(harness, "/allocations/batch", {
      ...previewBody("2026-01-31", "JPY", adjustments, "Trip"),
      preview_token: preview.token,
    });
    expect(saved.status).toBe(200);
    const result = await saved.json() as { logs: { budget_category_id: number; amount: number; note: string | null; date: string; created_at: string }[] };
    expect(result.logs.map(({ budget_category_id, amount, note, date }) => ({ budget_category_id, amount, note, date }))).toEqual([
      { budget_category_id: a, amount: -10_000, note: "Trip", date: "2026-01-31" },
      { budget_category_id: b, amount: 8_000, note: "Trip", date: "2026-01-31" },
    ]);
    expect(result.logs[0]!.created_at).toBe(result.logs[1]!.created_at);
    expect(harness.sqlite.query("SELECT COUNT(*) AS n FROM budget_adjustment_logs").get<{ n: number }>()!.n).toBe(initialCount + 2);
  });

  test("computes projected allocatable money from positive category balances after caps", async () => {
    const harness = fixture();
    const overflow = addCategory(harness, "Overflow", { sort_order: 0 });
    const capped = addCategory(harness, "Capped", { sort_order: 1, balance_cap: 1_000, overflow_budget_category_id: overflow });
    const deficit = addCategory(harness, "Deficit", { sort_order: 2 });
    addLog(harness, capped, 1_500, "2026-01-01");
    addLog(harness, deficit, -5_000, "2026-01-01");

    const response = await request(harness, "/allocations/preview", previewBody("2026-01-31", "JPY", [
      { budget_category_id: deficit, adhoc_delta: 3_000 },
      { budget_category_id: capped, adhoc_delta: 500 },
    ]));
    expect(response.status).toBe(200);
    const preview = await response.json() as Preview;
    const byId = new Map(preview.categories.map((item) => [item.budget_category_id, item]));
    expect(byId.get(capped)).toEqual({ budget_category_id: capped, before_available: 1_000, after_available: 1_000 });
    expect(byId.get(overflow)).toEqual({ budget_category_id: overflow, before_available: 500, after_available: 1_000 });
    expect(byId.get(deficit)).toEqual({ budget_category_id: deficit, before_available: -5_000, after_available: -2_000 });
    expect(preview.adjustment_total).toBe(3_500);
    expect(preview.allocatable_before).toBe(48_500);
    expect(preview.allocatable_after).toBe(48_000);
  });

  test("honors an historical reset cutoff and currency minor units", async () => {
    const harness = fixture();
    const categoryId = addCategory(harness, "Historical");
    addLog(harness, categoryId, 1_000, "2026-01-01");
    addLog(harness, categoryId, -1_000, "2026-01-10", "JPY", "reset", "2026-01-10 10:00:00");
    addLog(harness, categoryId, 9_000, "2026-01-20");
    addLog(harness, categoryId, 123_45, "2026-01-01", "USD");

    const response = await request(harness, "/allocations/preview", previewBody("2026-01-15", "USD", [
      { budget_category_id: categoryId, adhoc_delta: 1.25 },
    ]));
    expect(response.status).toBe(200);
    const preview = await response.json() as Preview;
    expect(preview.categories.find((item) => item.budget_category_id === categoryId)).toEqual({
      budget_category_id: categoryId,
      before_available: 123.45,
      after_available: 124.7,
    });
    expect(preview.adjustment_total).toBe(1.25);
  });

  test("rejects invalid dates, disabled currencies, archived or duplicate categories, bad precision, and zero-only saves without writes", async () => {
    const harness = fixture();
    const active = addCategory(harness, "Active");
    const archived = addCategory(harness, "Archived", { is_archived: 1 });
    const count = () => harness.sqlite.query("SELECT COUNT(*) AS n FROM budget_adjustment_logs").get<{ n: number }>()!.n;
    const initialCount = count();
    const invalidCases = [
      previewBody("2026-02-30", "JPY", []),
      previewBody("2026-02-01", "EUR", []),
      previewBody("2026-02-01", "JPY", [{ budget_category_id: archived, adhoc_delta: 100 }]),
      previewBody("2026-02-01", "JPY", [{ budget_category_id: active, adhoc_delta: 100 }, { budget_category_id: active, adhoc_delta: 200 }]),
      previewBody("2026-02-01", "JPY", [{ budget_category_id: active, adhoc_delta: 1.5 }]),
    ];
    for (const body of invalidCases) expect((await request(harness, "/allocations/preview", body)).status).toBe(400);
    const zeroPreview = await request(harness, "/allocations/preview", previewBody("2026-02-01", "JPY", [
      { budget_category_id: active, adhoc_delta: 0 },
    ]));
    expect(zeroPreview.status).toBe(200);
    const zero = await zeroPreview.json() as Preview;
    expect((await request(harness, "/allocations/batch", {
      ...previewBody("2026-02-01", "JPY", []), preview_token: zero.token,
    })).status).toBe(400);
    expect(count()).toBe(initialCount);
  });

  test("rejects stale or mismatched previews and rolls back every row when a later insert fails", async () => {
    const harness = fixture();
    const a = addCategory(harness, "A", { sort_order: 0 });
    const b = addCategory(harness, "B", { sort_order: 1 });
    const adjustments = [{ budget_category_id: a, adhoc_delta: -1_000 }, { budget_category_id: b, adhoc_delta: 1_000 }];
    const body = previewBody("2026-01-31", "JPY", adjustments);
    const previewResponse = await request(harness, "/allocations/preview", body);
    expect(previewResponse.status).toBe(200);
    const preview = await previewResponse.json() as Preview;

    addLog(harness, a, 1, "2026-01-05");
    const stale = await request(harness, "/allocations/batch", { ...body, preview_token: preview.token });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ error: "adjustment_preview_stale" });

    const freshResponse = await request(harness, "/allocations/preview", body);
    const fresh = await freshResponse.json() as Preview;
    const mismatched = await request(harness, "/allocations/batch", {
      ...previewBody("2026-01-31", "JPY", [{ budget_category_id: a, adhoc_delta: 5 }]),
      preview_token: fresh.token,
    });
    expect(mismatched.status).toBe(409);
    expect(await mismatched.json()).toMatchObject({ error: "adjustment_preview_stale" });

    harness.sqlite.exec(`CREATE TRIGGER fail_second_batch_log BEFORE INSERT ON budget_adjustment_logs
      WHEN NEW.budget_category_id = ${b} AND NEW.note = 'rollback'
      BEGIN SELECT RAISE(ABORT, 'injected insert failure'); END;`);
    const rollbackPreviewResponse = await request(harness, "/allocations/preview", previewBody("2026-01-31", "JPY", adjustments, "rollback"));
    const rollbackPreview = await rollbackPreviewResponse.json() as Preview;
    const before = harness.sqlite.query("SELECT COUNT(*) AS n FROM budget_adjustment_logs").get<{ n: number }>()!.n;
    await expect(request(harness, "/allocations/batch", {
      ...previewBody("2026-01-31", "JPY", adjustments, "rollback"),
      preview_token: rollbackPreview.token,
    })).rejects.toThrow("injected insert failure");
    expect(harness.sqlite.query("SELECT COUNT(*) AS n FROM budget_adjustment_logs").get<{ n: number }>()!.n).toBe(before);
  });
});
