import { afterEach, beforeEach, expect, test } from "bun:test";
import app from "../src/index";
import { depreciationRouter } from "../src/routes/depreciation";
import { createTestD1 } from "./helpers/d1";
import { createIncomeBudgetScopeFixture } from "./helpers/incomeBudgetScopeFixture";

let fixture: ReturnType<typeof createIncomeBudgetScopeFixture>;
beforeEach(() => { fixture = createIncomeBudgetScopeFixture(); });
afterEach(() => fixture.close());

function seedEntry(id: number) {
  fixture.sqlite.exec(`INSERT INTO journal_entries(id,date,description) VALUES(${id},'2026-10-20','special entry')`);
  fixture.sqlite.exec(`INSERT INTO journal_lines(journal_entry_id,account_id,debit,credit) VALUES(${id},1006,400,0),(${id},1001,0,400)`);
}

test("account replacement records the affected journal before reassignment and account removal", async () => {
  seedEntry(9901);
  fixture.sqlite.exec("INSERT INTO accounts(id,name,type,category) VALUES(1010,'Replacement expense','expense','other')");
  const response = await app.request("/api/accounts/1006/replace", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ replace_with_id: 1010 }),
  }, { DB: fixture.DB });
  expect(response.status).toBe(200);
  const history = await (await app.request("/api/journal-history", {}, { DB: fixture.DB })).json();
  expect(history.entries[0]).toMatchObject({ reason: "edited", entry: {
    id: 9901, lines: expect.arrayContaining([expect.objectContaining({ account_id: 1006, account_name: "テスト費用", debit: 400 })]),
  } });
});

test("explicit erase-all clears journal snapshots and restores the default retention setting", async () => {
  seedEntry(9901);
  expect((await app.request("/api/journal/9901", { method: "DELETE" }, { DB: fixture.DB })).status).toBe(200);
  await app.request("/api/journal-history/settings", {
    method: "PATCH", headers: { "content-type": "application/json" },
    body: JSON.stringify({ retention_limit: 7 }),
  }, { DB: fixture.DB });
  const response = await app.request("/api/admin/erase", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ scope: "all_data" }),
  }, { DB: fixture.DB });
  expect(response.status).toBe(200);
  const history = await (await app.request("/api/journal-history", {}, { DB: fixture.DB })).json();
  expect(history).toMatchObject({ retention_limit: 100, total: 0, entries: [] });
});

test("legacy depreciation regeneration snapshots the purchase and removed monthly entries atomically", async () => {
  const local = createTestD1();
  try {
    local.sqlite.exec(`
      INSERT INTO accounts(id,name,type,category,is_depreciable) VALUES
        (1001,'Bank','asset','cash',0),(1002,'Equipment','asset','property',1),
        (1003,'Expense','expense','other',0);
    `);
    const purchaseId = local.sqlite.query(`INSERT INTO journal_entries(date,description)
      VALUES('2026-01-01','Old equipment') RETURNING id`).get<{ id: number }>()!.id;
    local.sqlite.query(`INSERT INTO journal_lines(journal_entry_id,account_id,debit,credit,currency)
      VALUES(?,1002,120,0,'JPY'),(?,1001,0,120,'JPY')`).run(purchaseId, purchaseId);
    const scheduleId = local.sqlite.query(`INSERT INTO depreciation_schedules
      (source_journal_entry_id,asset_account_id,expense_account_id,total_amount,months,start_date,description)
      VALUES(?,1002,1003,120,2,'2026-01-01','Old equipment') RETURNING id`)
      .get<{ id: number }>(purchaseId)!.id;
    const oldMonthlyId = 9901;
    local.sqlite.query("INSERT INTO journal_entries(id,date,description) VALUES(?,'2026-01-01','Old monthly')").run(oldMonthlyId);
    local.sqlite.query("INSERT INTO journal_lines(journal_entry_id,account_id,debit,credit) VALUES(?,1003,60,0),(?,1002,0,60)").run(oldMonthlyId, oldMonthlyId);
    local.sqlite.query("INSERT INTO depreciation_entries(schedule_id,journal_entry_id,month_number) VALUES(?,?,1)").run(scheduleId, oldMonthlyId);

    const response = await depreciationRouter.request(`/${scheduleId}`, {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ months: 3 }),
    }, { DB: local.DB });
    expect(response.status).toBe(200);
    let history = await (await app.request("/api/journal-history", {}, { DB: local.DB })).json();
    expect(history.total).toBe(2);
    expect(history.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ original_journal_entry_id: purchaseId, reason: "edited" }),
      expect.objectContaining({ original_journal_entry_id: oldMonthlyId, reason: "deleted" }),
    ]));

    const noOp = await depreciationRouter.request(`/${scheduleId}`, {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ months: 3 }),
    }, { DB: local.DB });
    expect(noOp.status).toBe(200);
    history = await (await app.request("/api/journal-history", {}, { DB: local.DB })).json();
    expect(history.total).toBe(2);
  } finally {
    local.close();
  }
});
