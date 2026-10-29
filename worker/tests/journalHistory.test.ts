import { afterEach, beforeEach, expect, test } from "bun:test";
import app from "../src/index";
import { createIncomeBudgetScopeFixture } from "./helpers/incomeBudgetScopeFixture";

let fixture: ReturnType<typeof createIncomeBudgetScopeFixture>;
beforeEach(() => { fixture = createIncomeBudgetScopeFixture(); });
afterEach(() => fixture.close());

async function request(path: string, method = "GET", body?: unknown) {
  return app.request(`/api${path}`, {
    method, headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, { DB: fixture.DB, DISABLE_ADMIN_API: "1" });
}
function seed(id: number, amount = 250, description = `entry ${id}`) {
  fixture.sqlite.query("INSERT INTO journal_entries(id,date,description,source) VALUES(?,'2026-10-20',?,'manual')").run(id, description);
  fixture.sqlite.query("INSERT INTO journal_lines(journal_entry_id,account_id,debit,credit) VALUES(?,1006,?,0),(?,1001,0,?)").run(id, amount, id, amount);
}
const edit = (amount: number) => ({ date: "2026-10-21", description: "edited entry", lines: [
  { account_id: 1006, debit: amount, credit: 0 }, { account_id: 1001, debit: 0, credit: amount },
] });

test("deletion flags and preserves a full independent copy while excluding it from the ledger", async () => {
  seed(9100);
  fixture.sqlite.exec("INSERT INTO journal_entry_budget_allocations(journal_entry_id,budget_category_id,amount,currency,source,is_reference) VALUES(9100,1001,250,'JPY','simple',0)");
  expect((await request("/journal/9100", "DELETE")).status).toBe(200);
  expect((await request("/journal/9100")).status).toBe(404);
  const history = await request("/journal-history");
  expect(history.status).toBe(200);
  const body = await history.json();
  expect(body).toMatchObject({ retention_limit: 100, total: 1 });
  expect(body.entries[0]).toMatchObject({ original_journal_entry_id: 9100, is_deleted: true, reason: "deleted", entry: {
    id: 9100, description: "entry 9100", source: "manual",
    lines: expect.arrayContaining([expect.objectContaining({ account_id: 1006, account_name: "テスト費用", debit: 250 })]),
    budget_allocations: [expect.objectContaining({ budget_category_id: 1001, amount: 250 })],
  } });
  fixture.sqlite.exec("UPDATE accounts SET name='renamed' WHERE id=1006; DELETE FROM budget_categories WHERE id=1001");
  const retained = await (await request("/journal-history")).json();
  expect(retained.entries[0].entry.lines[0].account_name).toBe("テスト費用");
  expect(retained.entries[0].entry.budget_allocations[0].amount).toBe(250);
  const accounts = await (await request("/accounts")).json();
  expect(accounts.find((account: {id:number}) => account.id === 1001).balance).toBe(100000);
});

test("repeated edits keep each pre-edit version and deleting keeps the latest version", async () => {
  seed(9100);
  expect((await request("/journal/9100", "PUT", edit(300))).status).toBe(200);
  expect((await request("/journal/9100", "PUT", edit(400))).status).toBe(200);
  expect((await request("/journal/9100", "DELETE")).status).toBe(200);
  const body = await (await request("/journal-history")).json();
  expect(body.entries.map((row: any) => row.reason)).toEqual(["deleted", "edited", "edited"]);
  expect(body.entries.map((row: any) => row.entry.lines[0].debit)).toEqual([400, 300, 250]);
});

test("failed validation and transactional failures do not leave history or change originals", async () => {
  seed(9100);
  const invalid = edit(300);
  invalid.lines[1]!.credit = 1;
  expect((await request("/journal/9100", "PUT", invalid)).status).toBe(400);
  fixture.sqlite.exec("CREATE TRIGGER reject_delete BEFORE DELETE ON journal_entries WHEN OLD.id=9100 BEGIN SELECT RAISE(ABORT,'test rejection'); END");
  expect((await request("/journal/9100", "DELETE")).status).toBe(500);
  expect((await (await request("/journal-history")).json()).total).toBe(0);
  expect((await request("/journal/9100")).status).toBe(200);
});

test("bulk deletion retains the latest 100 by archival order and lowering the limit prunes immediately", async () => {
  for (let id = 9100; id < 9202; id++) seed(id);
  const deletion = await request("/journal/bulk-delete", "POST", { entry_ids: Array.from({ length: 102 }, (_, index) => 9100 + index) });
  expect(deletion.status).toBe(200);
  const body = await (await request("/journal-history?limit=200")).json();
  expect(body.total).toBe(100);
  expect(body.entries.map((row: any) => row.original_journal_entry_id)).toEqual(Array.from({length: 100}, (_, index) => 9201 - index));
  const settings = await request("/journal-history/settings", "PATCH", { retention_limit: 2 });
  expect(settings.status).toBe(200);
  const reduced = await (await request("/journal-history")).json();
  expect(reduced.retention_limit).toBe(2);
  expect(reduced.entries.map((row: any) => row.original_journal_entry_id)).toEqual([9201, 9200]);
  expect((await (await request("/journal-history?offset=1&limit=1")).json()).entries).toHaveLength(1);
});

test("invalid limits and pagination are rejected without pruning", async () => {
  for (const retention_limit of [0, -1, 1.5, "20", 10001]) {
    expect((await request("/journal-history/settings", "PATCH", { retention_limit })).status).toBe(400);
  }
  expect((await request("/journal-history?offset=-1")).status).toBe(400);
  expect((await request("/journal-history?limit=201")).status).toBe(400);
});

test("bulk replacement archives only affected entries, without affecting dry runs", async () => {
  seed(9100); seed(9101);
  fixture.sqlite.exec("UPDATE journal_lines SET account_id=1007 WHERE journal_entry_id=9101 AND account_id=1001");
  expect((await request("/journal/bulk-replace", "POST", { from_account_id: 1001, to_account_id: 1007, dry_run: true })).status).toBe(200);
  expect((await (await request("/journal-history")).json()).total).toBe(0);
  expect((await request("/journal/bulk-replace", "POST", { from_account_id: 1001, to_account_id: 1007, entry_ids: [9100, 9101] })).status).toBe(200);
  const body = await (await request("/journal-history")).json();
  expect(body.total).toBe(1);
  expect(body.entries[0].entry.lines.some((line: any) => line.account_id === 1001)).toBe(true);
});

test("currency precision is fixed at archival time", async () => {
  fixture.sqlite.exec("INSERT INTO enabled_currencies(code,decimal_places) VALUES('USD',2)");
  seed(9100, 1234);
  fixture.sqlite.exec("UPDATE journal_lines SET currency='USD' WHERE journal_entry_id=9100");
  expect((await request("/journal/9100", "DELETE")).status).toBe(200);
  fixture.sqlite.exec("UPDATE enabled_currencies SET decimal_places=3 WHERE code='USD'");
  const body = await (await request("/journal-history")).json();
  expect(body.entries[0].entry.lines[0].debit).toBe(12.34);
});

test("associated depreciation money uses its archived budget currency", async () => {
  fixture.sqlite.exec("INSERT INTO enabled_currencies(code,decimal_places) VALUES('USD',2)");
  seed(9100, 12345);
  fixture.sqlite.exec(`
    UPDATE journal_lines SET currency='USD' WHERE journal_entry_id=9100;
    INSERT INTO depreciation_schedules(source_journal_entry_id,asset_account_id,expense_account_id,total_amount,months,start_date,budget_currency,budget_target_amount)
      VALUES(9100,1001,1006,12345,1,'2026-10-20','USD',5000);
  `);
  expect((await request("/journal/9100", "DELETE")).status).toBe(200);
  const body = await (await request("/journal-history")).json();
  expect(body.entries[0].related_records.depreciation_schedules[0]).toMatchObject({ total_amount: 123.45, budget_target_amount: 50 });
});

test("a failed mutation rolls back eviction as well as its new candidate", async () => {
  await request("/journal-history/settings", "PATCH", { retention_limit: 1 });
  seed(9100); seed(9101); seed(9102);
  expect((await request("/journal/9100", "DELETE")).status).toBe(200);
  fixture.sqlite.exec(`
    CREATE TRIGGER reject_another_delete BEFORE DELETE ON journal_entries WHEN OLD.id=9101
      BEGIN SELECT RAISE(ABORT,'test delete rejection'); END;
    CREATE TRIGGER reject_edit BEFORE UPDATE ON journal_entries WHEN OLD.id=9102
      BEGIN SELECT RAISE(ABORT,'test edit rejection'); END;
  `);
  expect((await request("/journal/9101", "DELETE")).status).toBe(500);
  expect((await request("/journal/9102", "PUT", edit(300))).status).toBe(500);
  const body = await (await request("/journal-history")).json();
  expect(body.total).toBe(1);
  expect(body.entries[0].original_journal_entry_id).toBe(9100);
  expect((await (await request("/journal/9102")).json()).description).toBe("entry 9102");
});

test("reference classification edits retain original allocation and skip no-op toggles", async () => {
  seed(9100);
  fixture.sqlite.exec("INSERT INTO journal_entry_budget_allocations(journal_entry_id,budget_category_id,amount,currency,is_reference) VALUES(9100,1001,250,'JPY',0)");
  for (let index = 0; index < 2; index++) {
    expect((await request("/journal/9100/budget-allocations/reference", "PATCH", { is_reference: true })).status).toBe(200);
  }
  const body = await (await request("/journal-history")).json();
  expect(body.total).toBe(1);
  expect(body.entries[0].entry.budget_allocations[0].is_reference).toBe(false);
});

test("retains a transfer requirement's saved category name after its category was removed", async () => {
  seed(9100);
  fixture.sqlite.exec(`
    INSERT INTO income_transfer_requirements(source_income_journal_entry_id,budget_category_id,budget_category_name,from_account_id,to_account_id,amount,currency)
      VALUES(9100,NULL,'廃止済み予算',1001,1007,250,'JPY');
  `);
  expect((await request("/journal/9100", "DELETE")).status).toBe(200);
  const body = await (await request("/journal-history")).json();
  expect(body.entries[0].related_records.income_transfer_requirements[0].budget_category_name).toBe("廃止済み予算");
});

test("a deleted USD balance confirmation retains the adjustment currency and value", async () => {
  fixture.sqlite.exec("INSERT INTO enabled_currencies(code,decimal_places) VALUES('USD',2)");
  const response = await request("/trial-balance/snapshots", "POST", {
    snapshot_date: "2026-10-20", general_entries: [{ account_id: 1001, amount: 123.45, currency: "USD" }],
  });
  expect(response.status).toBe(201);
  const snapshot = await response.json();
  const adjustment = await request(`/trial-balance/snapshots/${snapshot.id}/adjustments`, "POST", {});
  expect(adjustment.ok).toBe(true);
  expect((await request(`/trial-balance/snapshots/${snapshot.id}`, "DELETE")).status).toBe(200);
  const history = await (await request("/journal-history")).json();
  expect(history.entries[0].related_records.actual_balance_adjustments[0]).toMatchObject({ amount: 123.45, currency: "USD" });
});
