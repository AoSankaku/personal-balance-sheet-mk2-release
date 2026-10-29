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
