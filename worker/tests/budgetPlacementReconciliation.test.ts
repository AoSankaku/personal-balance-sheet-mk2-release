import { afterEach, expect, test } from "bun:test";
import type { BudgetPlacementReconciliation } from "@balance-sheet/shared";
import { incomeTransferRequirementsRouter } from "../src/routes/incomeTransferRequirements";
import { toLocalDateString } from "../src/lib/appDate";
import { createIncomeBudgetScopeFixture } from "./helpers/incomeBudgetScopeFixture";

const fixtures: ReturnType<typeof createIncomeBudgetScopeFixture>[] = [];
afterEach(() => fixtures.splice(0).forEach(fixture => fixture.close()));

function setup(maxParameters?: number) {
  const fixture = createIncomeBudgetScopeFixture(maxParameters ? { maxParameters } : undefined);
  fixtures.push(fixture);
  const today = toLocalDateString();
  const tomorrow = new Date(`${today}T00:00:00Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const future = tomorrow.toISOString().slice(0, 10);
  fixture.sqlite.exec(`
    INSERT INTO accounts(id,name,type,category,include_in_allocatable,deduct_from_budget) VALUES
      (1010,'SBI','asset','cash',1,0),(1011,'Tax','asset','cash',1,0),
      (1012,'Housing','asset','cash',1,0),(1013,'Nontracked','asset','cash',0,0),
      (1014,'Expense','expense','other',1,0);
    INSERT INTO budget_categories(id,name) VALUES
      (1002,'Free'),(1003,'Necessary'),(1004,'SBI reserve'),(1005,'Tax reserve'),(1006,'Housing reserve');
    INSERT INTO budget_category_account_targets(budget_category_id,account_id,ratio) VALUES
      (1001,1001,100),(1002,1001,100),(1003,1001,100),
      (1004,1010,100),(1005,1011,100),(1006,1012,100);
    INSERT INTO budget_allocations(budget_category_id,year_month,currency,fixed_amount,adhoc_amount) VALUES
      (1001,substr('${today}',1,7),'JPY',100,0),(1002,substr('${today}',1,7),'JPY',100,0),
      (1003,substr('${today}',1,7),'JPY',100,0),(1004,substr('${today}',1,7),'JPY',100,0),
      (1005,substr('${today}',1,7),'JPY',100,0),(1006,substr('${today}',1,7),'JPY',100,0);
    INSERT INTO journal_entries(id,date,description) VALUES
      (9100,'${today}','opening balances'),(9101,'${today}','current income'),(9102,'${future}','future income');
    INSERT INTO journal_lines(journal_entry_id,account_id,debit,credit,currency) VALUES
      (9100,1001,100,0,'JPY'),(9100,1007,100,0,'JPY'),(9100,1010,120,0,'JPY'),(9100,1011,110,0,'JPY'),(9100,1012,90,0,'JPY'),(9100,1008,0,520,'JPY'),
      (9101,1001,10,0,'JPY'),(9101,1005,0,10,'JPY'),
      (9102,1001,5,0,'JPY'),(9102,1005,0,5,'JPY');
    INSERT INTO journal_entries(id,date,description) VALUES (9103,'${today}','tax withholding');
    INSERT INTO journal_lines(journal_entry_id,account_id,debit,credit,currency) VALUES
      (9103,1014,1,0,'JPY'),(9103,1010,0,1,'JPY');
    INSERT INTO journal_entry_budget_allocations(journal_entry_id,budget_category_id,amount,currency,source)
      VALUES (9103,1005,1,'JPY','expense');
    INSERT INTO income_transfer_requirements(id,source_income_journal_entry_id,budget_category_id,budget_category_name,from_account_id,to_account_id,amount,currency,created_at)
      VALUES (9201,9101,1001,'Daily',1001,1007,2,'JPY',datetime('now')),
             (9202,9102,1001,'Daily',1001,1007,5,'JPY',datetime('now')),
             (9203,9101,1001,'Daily',1001,1013,7,'JPY',datetime('now'));
  `);
  return fixture;
}

function setupThreeTransferPlacement() {
  const fixture = setup();
  fixture.sqlite.exec(`
    UPDATE income_transfer_requirements SET from_account_id=1011,to_account_id=1001 WHERE id=9201;
    DELETE FROM budget_adjustment_logs;
    INSERT INTO budget_adjustment_logs(budget_category_id,year_month,amount,currency,date,adjustment_type) VALUES
      (1002,substr('${toLocalDateString()}',1,7),100,'JPY','${toLocalDateString()}','allocation'),
      (1004,substr('${toLocalDateString()}',1,7),9,'JPY','${toLocalDateString()}','allocation'),
      (1005,substr('${toLocalDateString()}',1,7),19,'JPY','${toLocalDateString()}','allocation'),
      (1006,substr('${toLocalDateString()}',1,7),10,'JPY','${toLocalDateString()}','allocation');
    DELETE FROM budget_category_account_targets;
    INSERT INTO budget_category_account_targets(budget_category_id,account_id,ratio) VALUES
      (1002,1001,100),(1004,1010,100),(1005,1011,100),(1006,1012,100);
    UPDATE budget_allocations SET fixed_amount=0,adhoc_amount=0 WHERE year_month=substr('${toLocalDateString()}',1,7) AND currency='JPY';
    UPDATE budget_allocations SET fixed_amount=100 WHERE budget_category_id=1002 AND year_month=substr('${toLocalDateString()}',1,7) AND currency='JPY';
    UPDATE budget_allocations SET fixed_amount=9 WHERE budget_category_id=1004 AND year_month=substr('${toLocalDateString()}',1,7) AND currency='JPY';
    UPDATE budget_allocations SET fixed_amount=21 WHERE budget_category_id=1005 AND year_month=substr('${toLocalDateString()}',1,7) AND currency='JPY';
    UPDATE budget_allocations SET fixed_amount=10 WHERE budget_category_id=1006 AND year_month=substr('${toLocalDateString()}',1,7) AND currency='JPY';
    UPDATE journal_lines SET debit=78 WHERE journal_entry_id=9100 AND account_id=1001;
    UPDATE journal_lines SET debit=0 WHERE journal_entry_id=9000 AND account_id=1001;
    UPDATE journal_lines SET debit=0 WHERE journal_entry_id=9100 AND account_id=1007;
    UPDATE journal_lines SET debit=8 WHERE journal_entry_id=9100 AND account_id=1010;
    UPDATE journal_lines SET debit=30 WHERE journal_entry_id=9100 AND account_id=1011;
    UPDATE journal_lines SET debit=14 WHERE journal_entry_id=9100 AND account_id=1012;
    UPDATE journal_lines SET credit=130 WHERE journal_entry_id=9100 AND account_id=1008;
  `);
  return fixture;
}

test("preview includes current scoped placement, pending income, evidence and card liabilities", async () => {
  const fixture = setup();
  const response = await incomeTransferRequirementsRouter.request("/placement-preview?currency=JPY", {}, { DB: fixture.DB });
  expect(response.status).toBe(200);
  const result = await response.json() as BudgetPlacementReconciliation;
  expect(result.as_of).toBe(toLocalDateString());
  expect(result.currency).toBe("JPY");
  expect(result.requirement_ids).toEqual([9201]);
  expect(result.pending_transfers.map(t => t.amount)).toEqual([2]);
  expect(result.expense_evidence.map(e => e.journal_entry_id)).toEqual([9103]);
  expect(result.transfers.every(t => t.from_account_id !== 1013 && t.to_account_id !== 1013)).toBe(true);
  expect(result.liability_total).toBe(5000);
  expect(result.adjusted_total_difference).toBe(result.total_difference - 5000);
});

test("completion creates all three planned physical transfers and undo removes them", async () => {
  const fixture = setupThreeTransferPlacement();
  const previewResponse = await incomeTransferRequirementsRouter.request("/placement-preview?currency=JPY", {}, { DB: fixture.DB });
  expect(previewResponse.status).toBe(200);
  const preview = await previewResponse.json() as BudgetPlacementReconciliation;
  expect(preview.transfers).toHaveLength(3);
  expect(preview.transfers).toEqual([
    expect.objectContaining({ from_account_id: 1011, to_account_id: 1001, amount: 10 }),
    expect.objectContaining({ from_account_id: 1012, to_account_id: 1001, amount: 2 }),
    expect.objectContaining({ from_account_id: 1012, to_account_id: 1010, amount: 2 }),
  ]);
  const response = await incomeTransferRequirementsRouter.request("/placement-complete", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ currency: "JPY", token: preview.token, description: "Reconcile budget placement" }),
  }, { DB: fixture.DB });
  expect(response.status).toBe(200);
  const completion = await response.json() as { transfer_journal_entry: { id: number } | null; transfers: Array<{ from_account_id: number; to_account_id: number; amount: number }> };
  expect(completion.transfer_journal_entry).not.toBeNull();
  expect(completion.transfers).toEqual(preview.transfers);
  const actualLines = fixture.sqlite.query("SELECT account_id,debit,credit,currency FROM journal_lines WHERE journal_entry_id=? ORDER BY account_id,debit DESC").all(completion.transfer_journal_entry!.id);
  const expectedLines = preview.transfers.flatMap(transfer => [
    { account_id: transfer.to_account_id, debit: transfer.amount, credit: 0, currency: "JPY" },
    { account_id: transfer.from_account_id, debit: 0, credit: transfer.amount, currency: "JPY" },
  ]).sort((a, b) => a.account_id - b.account_id || b.debit - a.debit);
  expect(actualLines).toEqual(expectedLines);
  expect(fixture.sqlite.query("SELECT COUNT(*) AS n FROM budget_adjustment_logs WHERE journal_entry_id=(SELECT MAX(id) FROM journal_entries)").get()).toEqual({ n: 0 });
  expect(fixture.sqlite.query("SELECT completion_source FROM income_transfer_requirements WHERE id=9201").get()).toEqual({ completion_source: "created" });
  expect(fixture.sqlite.query("SELECT completion_source FROM income_transfer_requirements WHERE id IN (9202,9203)").all()).toEqual([{ completion_source: null }, { completion_source: null }]);
  const duplicate = await incomeTransferRequirementsRouter.request("/placement-complete", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ currency: "JPY", token: preview.token, description: "Duplicate" }),
  }, { DB: fixture.DB });
  expect(duplicate.status).toBe(409);
  const undo = await incomeTransferRequirementsRouter.request(`/9201/cancel`, { method: "POST" }, { DB: fixture.DB });
  expect(undo.status).toBe(200);
  expect(fixture.sqlite.query("SELECT COUNT(*) AS n FROM journal_entries WHERE id=?").get(completion.transfer_journal_entry!.id)).toEqual({ n: 0 });
  expect(fixture.sqlite.query("SELECT COUNT(*) AS n FROM journal_lines WHERE journal_entry_id=?").get(completion.transfer_journal_entry!.id)).toEqual({ n: 0 });
  expect(fixture.sqlite.query("SELECT completion_source FROM income_transfer_requirements WHERE id=9201").get()).toEqual({ completion_source: null });
});

test("creates a placement transfer when no saved income requirements exist", async () => {
  const fixture = setupThreeTransferPlacement();
  fixture.sqlite.exec("DELETE FROM income_transfer_requirements");
  const previewResponse = await incomeTransferRequirementsRouter.request("/placement-preview?currency=JPY", {}, { DB: fixture.DB });
  expect(previewResponse.status).toBe(200);
  const preview = await previewResponse.json() as BudgetPlacementReconciliation;
  expect(preview.requirement_ids).toEqual([]);
  expect(preview.transfers).toHaveLength(3);
  const response = await incomeTransferRequirementsRouter.request("/placement-complete", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ currency: "JPY", token: preview.token, description: "Placement only" }),
  }, { DB: fixture.DB });
  expect(response.status).toBe(200);
  const result = await response.json() as { transfer_journal_entry: { id: number } | null };
  expect(result.transfer_journal_entry).not.toBeNull();
  const actualLines = fixture.sqlite.query("SELECT account_id,debit,credit,currency FROM journal_lines WHERE journal_entry_id=? ORDER BY account_id,debit DESC").all(result.transfer_journal_entry!.id);
  expect(actualLines).toHaveLength(6);
});

test("nets already-aligned income requirements without creating a zero-value journal", async () => {
  const fixture = setup();
  const previewResponse = await incomeTransferRequirementsRouter.request("/placement-preview?currency=JPY", {}, { DB: fixture.DB });
  expect(previewResponse.status).toBe(200);
  const preview = await previewResponse.json() as BudgetPlacementReconciliation;
  expect(preview.transfers).toEqual([]);
  expect(preview.requirement_ids).toEqual([9201]);
  expect((preview as BudgetPlacementReconciliation & { unresolved_requirement_ids: number[] }).unresolved_requirement_ids).toEqual([]);
  const response = await incomeTransferRequirementsRouter.request("/placement-complete", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ currency: "JPY", token: preview.token, description: "Already aligned" }),
  }, { DB: fixture.DB });
  expect(response.status).toBe(200);
  const result = await response.json() as { transfer_journal_entry: null; requirement_ids: number[] };
  expect(result.transfer_journal_entry).toBeNull();
  expect(result.requirement_ids).toEqual([9201]);
  expect(fixture.sqlite.query("SELECT transfer_journal_entry_id,completion_source FROM income_transfer_requirements WHERE id=9201").get()).toEqual({ transfer_journal_entry_id: null, completion_source: "created" });
});

test("leaves a placement requirement pending when the target group remains underfunded", async () => {
  const zero = setup();
  zero.sqlite.exec(`
    DELETE FROM budget_adjustment_logs;
    INSERT INTO budget_adjustment_logs(budget_category_id,year_month,amount,currency,date,adjustment_type)
      VALUES(1001,substr('${toLocalDateString()}',1,7),100,'JPY','${toLocalDateString()}','allocation');
    UPDATE journal_lines SET debit=0,credit=0 WHERE account_id IN (1001,1007,1010,1011,1012,1013);
  `);
  const zeroPreviewResponse = await incomeTransferRequirementsRouter.request("/placement-preview?currency=JPY", {}, { DB: zero.DB });
  const zeroPreview = await zeroPreviewResponse.json() as BudgetPlacementReconciliation & { unresolved_requirement_ids: number[] };
  expect(zeroPreview.transfers).toEqual([]);
  expect(zeroPreview.unresolved_requirement_ids).toContain(9201);
  const zeroComplete = await incomeTransferRequirementsRouter.request("/placement-complete", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ currency: "JPY", token: zeroPreview.token, description: "Cannot fund destination" }),
  }, { DB: zero.DB });
  expect(zeroComplete.status).toBe(409);
  expect(zero.sqlite.query("SELECT completion_source FROM income_transfer_requirements WHERE id=9201").get()).toEqual({ completion_source: null });

  const partial = setup();
  partial.sqlite.exec(`
    DELETE FROM budget_adjustment_logs;
    INSERT INTO budget_adjustment_logs(budget_category_id,year_month,amount,currency,date,adjustment_type)
      VALUES(1001,substr('${toLocalDateString()}',1,7),100,'JPY','${toLocalDateString()}','allocation');
    UPDATE journal_lines SET debit=0,credit=0 WHERE account_id IN (1001,1007,1010,1011,1012,1013);
    UPDATE journal_lines SET debit=50 WHERE journal_entry_id=9100 AND account_id=1012;
  `);
  const partialPreviewResponse = await incomeTransferRequirementsRouter.request("/placement-preview?currency=JPY", {}, { DB: partial.DB });
  const partialPreview = await partialPreviewResponse.json() as BudgetPlacementReconciliation & { unresolved_requirement_ids: number[] };
  expect(partialPreview.transfers).toEqual([{ from_account_id: 1012, to_account_id: 1001, amount: 50, currency: "JPY" }]);
  expect(partialPreview.unresolved_requirement_ids).toContain(9201);
  const partialComplete = await incomeTransferRequirementsRouter.request("/placement-complete", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ currency: "JPY", token: partialPreview.token, description: "Partially fund destination" }),
  }, { DB: partial.DB });
  expect(partialComplete.status).toBe(200);
  const partialResult = await partialComplete.json() as { transfer_journal_entry: { id: number }; unresolved_requirement_ids: number[] };
  expect(partialResult.unresolved_requirement_ids).toContain(9201);
  expect(partial.sqlite.query("SELECT completion_source FROM income_transfer_requirements WHERE id=9201").get()).toEqual({ completion_source: null });
  expect(partial.sqlite.query("SELECT account_id,debit,credit FROM journal_lines WHERE journal_entry_id=? ORDER BY account_id").all(partialResult.transfer_journal_entry.id)).toEqual([
    { account_id: 1001, debit: 50, credit: 0 },
    { account_id: 1012, debit: 0, credit: 50 },
  ]);
});

test("collects evidenced payments in D1-safe batches under the default parameter cap", async () => {
  const fixture = setup(100);
  const date = toLocalDateString();
  const insertEntry = fixture.sqlite.prepare("INSERT INTO journal_entries(id,date,description) VALUES(?,?,?)");
  const insertLine = fixture.sqlite.prepare("INSERT INTO journal_lines(journal_entry_id,account_id,debit,credit,currency) VALUES(?,?,?,?, 'JPY')");
  const insertAllocation = fixture.sqlite.prepare("INSERT INTO journal_entry_budget_allocations(journal_entry_id,budget_category_id,amount,currency,source) VALUES(?,1005,1,'JPY','expense')");
  for (let index = 0; index < 60; index++) {
    const id = 9300 + index;
    insertEntry.run(id, date, `Tax ${index}`);
    insertLine.run(id, 1014, 1, 0);
    insertLine.run(id, 1001, 0, 1);
    insertAllocation.run(id);
  }
  const response = await incomeTransferRequirementsRouter.request("/placement-preview?currency=JPY", {}, { DB: fixture.DB });
  expect(response.status).toBe(200);
  const preview = await response.json() as BudgetPlacementReconciliation;
  expect(preview.expense_evidence.filter(row => row.journal_entry_id >= 9300)).toHaveLength(60);
});

test("includes legacy signed expense allocations in cross-group payment evidence", async () => {
  const fixture = setup();
  const date = toLocalDateString();
  fixture.sqlite.exec(`
    INSERT INTO journal_entries(id,date,description) VALUES(9110,'${date}','legacy tax payment');
    INSERT INTO journal_lines(journal_entry_id,account_id,debit,credit,currency) VALUES
      (9110,1014,3,0,'JPY'),(9110,1010,0,3,'JPY');
    INSERT INTO journal_entry_budget_allocations(journal_entry_id,budget_category_id,amount,currency,source)
      VALUES(9110,1005,-3,'JPY',NULL);
  `);
  const response = await incomeTransferRequirementsRouter.request("/placement-preview?currency=JPY", {}, { DB: fixture.DB });
  expect(response.status).toBe(200);
  const preview = await response.json() as BudgetPlacementReconciliation;
  expect(preview.expense_evidence.find(row => row.journal_entry_id === 9110)).toMatchObject({
    from_account_id: 1010,
    to_group_id: "a:1011",
    amount: 3,
  });
});

test("applies the latest category reset boundary to historical and same-day expense evidence", async () => {
  const fixture = setup();
  fixture.sqlite.exec(`
    INSERT INTO budget_adjustment_logs(budget_category_id,year_month,amount,currency,date,adjustment_type,created_at)
      VALUES(1005,'2026-05',0,'JPY','2026-05-01','reset','2026-05-01 12:00:00');
    INSERT INTO journal_entries(id,date,description,created_at) VALUES
      (9110,'2026-03-22','expense before reset','2026-03-22 10:00:00'),
      (9111,'2026-05-01','expense after same-day reset','2026-05-01 12:00:01');
    INSERT INTO journal_lines(journal_entry_id,account_id,debit,credit,currency) VALUES
      (9110,1014,3,0,'JPY'),(9110,1010,0,3,'JPY'),
      (9111,1014,4,0,'JPY'),(9111,1010,0,4,'JPY');
    INSERT INTO journal_entry_budget_allocations(journal_entry_id,budget_category_id,amount,currency,source) VALUES
      (9110,1005,-3,'JPY',NULL),(9111,1005,-4,'JPY',NULL);
  `);
  const response = await incomeTransferRequirementsRouter.request("/placement-preview?currency=JPY", {}, { DB: fixture.DB });
  expect(response.status).toBe(200);
  const preview = await response.json() as BudgetPlacementReconciliation;
  const ids = preview.expense_evidence.map(row => row.journal_entry_id);
  expect(ids).toContain(9111);
  expect(ids).not.toContain(9110);
});

test("accepts the current SQLite representation of a fractional target ratio", async () => {
  const fixture = setup();
  fixture.sqlite.exec("UPDATE budget_category_account_targets SET ratio=0.3333333333333333 WHERE budget_category_id=1001 AND account_id=1007");
  const previewResponse = await incomeTransferRequirementsRouter.request("/placement-preview?currency=JPY", {}, { DB: fixture.DB });
  expect(previewResponse.status).toBe(200);
  const preview = await previewResponse.json() as BudgetPlacementReconciliation;
  const response = await incomeTransferRequirementsRouter.request("/placement-complete", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ currency: "JPY", token: preview.token, description: "Fractional target ratio" }),
  }, { DB: fixture.DB });
  expect(response.status).toBe(200);
});

test("rejects a stale preview when a journal change happened after calculation", async () => {
  const fixture = setup();
  const preview = await incomeTransferRequirementsRouter.request("/placement-preview?currency=JPY", {}, { DB: fixture.DB });
  const token = (await preview.json() as BudgetPlacementReconciliation).token;
  fixture.sqlite.exec("INSERT INTO journal_entries(date,description) VALUES('2026-10-20','concurrent'); INSERT INTO journal_lines(journal_entry_id,account_id,debit,credit,currency) VALUES(last_insert_rowid(),1001,1,0,'JPY')");
  const response = await incomeTransferRequirementsRouter.request("/placement-complete", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ currency: "JPY", token, description: "Stale" }),
  }, { DB: fixture.DB });
  expect(response.status).toBe(409);
});
