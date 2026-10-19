import { afterEach, expect, test } from "bun:test";
import type { DepreciationBudgetPreview, DepreciationBudgetSettings } from "../../shared/depreciationBudget";
import { depreciationRouter } from "../src/routes/depreciation";
import { budgetRouter } from "../src/routes/budget";
import { createTestD1 } from "./helpers/d1";

type Sources = { budget_category_id: number | null; ratio: number }[];
type Settings = DepreciationBudgetSettings & {
  monthly_source_allocations?: Sources;
  confirm_monthly_unallocated?: boolean;
};
const databases: ReturnType<typeof createTestD1>[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });

function fixture() {
  const h = createTestD1({ maxParameters: 100 }); databases.push(h);
  h.sqlite.exec(`INSERT INTO accounts(id,name,type,category,is_depreciable) VALUES
    (1001,'Cash','asset','cash',0),(1002,'Equipment','asset','property',1),
    (1003,'Depreciation','expense','other',0);
    INSERT INTO budget_categories(id,name) VALUES
    (1001,'Purchase'),(1002,'Living'),(1003,'Work'),(1004,'Future source');
    INSERT INTO budget_category_accounts(budget_category_id,account_id,ratio) VALUES
    (1002,1003,50),(1003,1003,50);`);
  return h;
}
function request(h: ReturnType<typeof fixture>, path: string, body: unknown) {
  return depreciationRouter.request(path, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify(body) }, { DB: h.DB });
}
function config(sources: Sources = [{ budget_category_id: 1003, ratio: 50 }, { budget_category_id: 1002, ratio: 50 }]): Settings {
  return { method: "assigned", purchase_category_id: 1001, monthly_source_category_id: 1002,
    monthly_source_allocations: sources };
}
function create(h: ReturnType<typeof fixture>, settings: Settings, options: { amount?: number; months?: number; currency?: string; date?: string } = {}) {
  return request(h, "/", { purchase_date: options.date ?? "2026-01-01", description: "Split purchase",
    asset_account_id: 1002, payment_account_id: 1001, expense_account_id: 1003,
    total_amount: options.amount ?? 5, months: options.months ?? 1, currency: options.currency ?? "JPY",
    idempotency_key: crypto.randomUUID(), budget_settings: settings });
}
async function scheduleId(response: Response) {
  expect(response.status).toBe(201);
  return (await response.json() as { schedule_id: number }).schedule_id;
}
function monthlyRows(h: ReturnType<typeof fixture>, id: number) {
  return h.sqlite.query(`SELECT budget_category_id,amount,depreciation_event_key AS key,depreciation_event_side AS side
    FROM budget_adjustment_logs WHERE depreciation_schedule_id=? AND depreciation_event_key LIKE 'monthly:%'
    ORDER BY depreciation_event_key,depreciation_event_side`).all(id) as { budget_category_id: number; amount: number; key: string; side: string }[];
}
async function preview(h: ReturnType<typeof fixture>, id: number, settings: Settings) {
  const response = await request(h, `/${id}/budget/preview`, { settings });
  expect(response.status).toBe(200);
  return await response.json() as DepreciationBudgetPreview;
}

for (const currency of ["JPY", "USD"]) {
  test(`${currency}: creation snapshots two sources and conserves an odd five-minor-unit month`, async () => {
    const h = fixture(), id = await scheduleId(await create(h, config(), { currency, amount: currency === "USD" ? 0.05 : 5 }));
    const rows = monthlyRows(h, id);
    expect(rows.filter(row => row.side === "source").map(row => [row.budget_category_id, row.amount])).toEqual([[1002, -3], [1003, -2]]);
    expect(rows.filter(row => row.side === "destination").reduce((sum, row) => sum + row.amount, 0)).toBe(5);
    expect(rows.reduce((sum, row) => sum + row.amount, 0)).toBe(0);
    expect(rows.map(row => row.key)).toEqual(["monthly:1:category:1002", "monthly:1:category:1002", "monthly:1:category:1003", "monthly:1:category:1003"]);
    const stored = h.sqlite.query("SELECT budget_settings FROM depreciation_schedules WHERE id=?").get(id) as { budget_settings: string };
    expect(JSON.parse(stored.budget_settings).monthly_source_allocations).toEqual([{ budget_category_id: 1002, ratio: 50 }, { budget_category_id: 1003, ratio: 50 }]);
  });
}

test("repair honors manually adjusted weights, persists a stable snapshot, and is idempotent", async () => {
  const h = fixture(), legacy: Settings = { method: "assigned", purchase_category_id: 1001, monthly_source_category_id: 1002 };
  const id = await scheduleId(await create(h, legacy, { amount: 7 }));
  const settings = config([{ budget_category_id: 1002, ratio: 25 }, { budget_category_id: 1003, ratio: 75 }]);
  const plan = await preview(h, id, settings);
  expect(plan.can_apply).toBe(true);
  expect(plan.changes.filter(change => change.event.kind === "monthly").map(change => [change.operation, change.event.source_category_id, change.event.amount]))
    .toEqual([["cancel", 1002, 7], ["add", 1002, 2], ["add", 1003, 5]]);
  const body = { token: plan.token, settings: plan.settings, confirmed: true };
  expect((await request(h, `/${id}/budget/apply`, body)).status).toBe(200);
  const before = monthlyRows(h, id);
  expect((await request(h, `/${id}/budget/apply`, body)).status).toBe(200);
  expect(monthlyRows(h, id)).toEqual(before);
  h.sqlite.exec("UPDATE budget_category_accounts SET ratio=100 WHERE budget_category_id=1002; DELETE FROM budget_category_accounts WHERE budget_category_id=1003;");
  const replay = await preview(h, id, plan.settings);
  expect(replay.changes).toEqual([]);
  expect(replay.progress.reimbursed_amount).toBe(7);
});

test("an explicit unallocated remainder requires consent and creates only its intended destination leg", async () => {
  const h = fixture(), settings = config([{ budget_category_id: 1002, ratio: 60 }, { budget_category_id: null, ratio: 40 }]);
  expect((await create(h, settings)).status).toBe(400);
  expect(h.sqlite.query("SELECT count(*) AS n FROM depreciation_schedules").get()).toEqual({ n: 0 });
  settings.confirm_monthly_unallocated = true;
  const id = await scheduleId(await create(h, settings));
  expect(monthlyRows(h, id)).toEqual([
    { budget_category_id: 1001, amount: 3, key: "monthly:1:category:1002", side: "destination" },
    { budget_category_id: 1002, amount: -3, key: "monthly:1:category:1002", side: "source" },
    { budget_category_id: 1001, amount: 2, key: "monthly:1:unallocated", side: "destination" },
  ]);
  expect((await preview(h, id, settings)).progress.reimbursed_amount).toBe(5);
  h.sqlite.query(`INSERT INTO budget_adjustment_logs(budget_category_id,year_month,amount,date,currency,adjustment_type,
    depreciation_schedule_id,depreciation_event_key,depreciation_event_side) VALUES(1004,'2026-01',99,'2026-01-01','JPY','transfer',?,'monthly:1:unallocated:orphan','destination')`).run(id);
  const listed = await depreciationRouter.request("/", {}, { DB: h.DB });
  const schedules = await listed.json() as { id: number; budget: { reimbursed_amount: number } }[];
  expect(schedules.find(row => row.id === id)!.budget.reimbursed_amount).toBe(5);
});

test("all positive sources participate in reset and archive protections, including dated routing", async () => {
  const h = fixture(), settings = { ...config(), routing_changes: [{ date: "2027-02-01", monthly_source_category_id: 1002,
    monthly_source_allocations: [{ budget_category_id: 1004, ratio: 100 }], destination_category_id: 1001 }] };
  const id = await scheduleId(await create(h, settings, { amount: 900, months: 3, date: "2027-01-01" }));
  const januarySources = monthlyRows(h, id).filter(row => row.key.startsWith("monthly:1:") && row.side === "source");
  expect(januarySources.map(row => [row.budget_category_id, row.amount])).toEqual([[1002, -150], [1003, -150]]);
  expect(monthlyRows(h, id).filter(row => row.key.startsWith("monthly:2:") && row.side === "source").map(row => [row.budget_category_id, row.amount])).toEqual([[1004, -300]]);
  const budgetRequest = (path: string, body: unknown) => budgetRouter.request(path, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }, { DB: h.DB });
  expect((await budgetRequest("/allocations", { budget_category_id: 1003, year_month: "2027-01", date: "2027-01-15", adjustment_type: "reset", adhoc_delta: 0 })).status).toBe(409);
  expect((await budgetRequest("/categories/1003", { is_archived: true })).status).toBe(409);
  expect((await budgetRequest("/categories/1004", { is_archived: true })).status).toBe(409);
});

test("legacy single-source repair remains a byte-stable no-op with its original monthly event key", async () => {
  const h = fixture(), settings: Settings = { method: "assigned", purchase_category_id: 1001, monthly_source_category_id: 1002 };
  const id = await scheduleId(await create(h, settings));
  const before = h.sqlite.query("SELECT budget_settings FROM depreciation_schedules WHERE id=?").get(id);
  const plan = await preview(h, id, settings);
  expect(plan.changes).toEqual([]);
  expect((await request(h, `/${id}/budget/apply`, { token: plan.token, settings: plan.settings, confirmed: true })).status).toBe(200);
  expect(h.sqlite.query("SELECT budget_settings FROM depreciation_schedules WHERE id=?").get(id)).toEqual(before);
  expect(monthlyRows(h, id).map(row => row.key)).toEqual(["monthly:1", "monthly:1"]);
});

const malformed: [string, Sources][] = [
  ["under100 without explicit U", [{ budget_category_id: 1002, ratio: 50 }]],
  ["over100", [{ budget_category_id: 1002, ratio: 60 }, { budget_category_id: 1003, ratio: 50 }]],
  ["duplicate", [{ budget_category_id: 1002, ratio: 50 }, { budget_category_id: 1002, ratio: 50 }]],
  ["negative", [{ budget_category_id: 1002, ratio: -1 }, { budget_category_id: 1003, ratio: 101 }]],
  ["invalid category", [{ budget_category_id: 1.5, ratio: 100 }]],
  ["self source", [{ budget_category_id: 1001, ratio: 100 }]],
];
for (const [name, sources] of malformed) {
  test(`rejects ${name} source distribution without creating accounting or budget records`, async () => {
    const h = fixture();
    const before = h.sqlite.query("SELECT count(*) AS n FROM journal_entries").get();
    expect((await create(h, config(sources))).status).toBe(400);
    expect(h.sqlite.query("SELECT count(*) AS n FROM depreciation_schedules").get()).toEqual({ n: 0 });
    expect(h.sqlite.query("SELECT count(*) AS n FROM journal_entries").get()).toEqual(before);
  });
}
