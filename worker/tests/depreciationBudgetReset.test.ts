import { afterEach, expect, test } from "bun:test";
import { createTestD1 } from "./helpers/d1";
import { depreciationRouter } from "../src/routes/depreciation";
import { budgetRouter } from "../src/routes/budget";
import { journalRouter } from "../src/routes/journal";
import { adminRouter } from "../src/routes/admin";

const databases: ReturnType<typeof createTestD1>[] = [];
afterEach(() => { for (const database of databases.splice(0)) database.close(); });

async function fixture(method = "assigned") {
  const database = createTestD1();
  databases.push(database);
  database.sqlite.exec(`
    INSERT INTO accounts(id,name,type,category,is_depreciable) VALUES
      (1001,'Bank','asset','cash',0),(1002,'Equipment','asset','other',1),
      (1003,'Depreciation','expense','other',0);
    INSERT INTO budget_categories(id,name) VALUES(1001,'Savings'),(1002,'Living');
  `);
  const response = await depreciationRouter.request("/", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ purchase_date: "2026-01-01", description: "Equipment",
      asset_account_id: 1002, payment_account_id: 1001, expense_account_id: 1003,
      total_amount: 300000, months: 30,
      idempotency_key: crypto.randomUUID(),
      budget_settings: { method, purchase_category_id: 1001, monthly_source_category_id: 1002 },
    }),
  }, { DB: database.DB });
  expect(response.status).toBe(201);
  return database;
}

function request(database: ReturnType<typeof createTestD1>, path: string, body: unknown, method = "PATCH") {
  return budgetRouter.request(path, { method, headers: { "content-type": "application/json" },
    body: JSON.stringify(body) }, { DB: database.DB });
}

function seededPlan(method: "assigned" | "special") {
  const database = createTestD1();
  databases.push(database);
  const destination = method === "special" ? 1003 : 1001;
  database.sqlite.exec(`
    INSERT INTO accounts(id,name,type,category,is_depreciable) VALUES
      (1001,'Bank','asset','cash',0),(1002,'Equipment','asset','property',1),(1003,'Depreciation','expense','other',0);
    INSERT INTO budget_categories(id,name) VALUES(1001,'Savings'),(1002,'Living'),(1003,'Special');
    INSERT INTO journal_entries(id,date,description,created_at) VALUES(7000,'2026-01-01','Purchase','2026-01-01 09:00:00');
    INSERT INTO journal_lines(journal_entry_id,account_id,debit,credit) VALUES(7000,1002,300000,0),(7000,1001,0,300000);
    INSERT INTO depreciation_schedules(id,source_journal_entry_id,asset_account_id,expense_account_id,total_amount,months,start_date,
      budget_method,budget_settings,budget_target_amount,budget_special_category_id)
      VALUES(100,7000,1002,1003,300000,30,'2026-01-01','${method}',
      '${JSON.stringify({method,purchase_category_id:method==='assigned'?1001:null,monthly_source_category_id:1002})}',300000,${method==='special'?1003:'NULL'});
    INSERT INTO budget_adjustment_logs(budget_category_id,year_month,amount,date,created_at) VALUES
      (1001,'2025-12',300000,'2025-12-31','2025-12-31 09:00:00'),(1002,'2025-12',100000,'2025-12-31','2025-12-31 09:00:00');
    INSERT INTO budget_adjustment_logs(budget_category_id,year_month,amount,date,created_at,adjustment_type,depreciation_schedule_id,depreciation_event_key,depreciation_event_side)
      VALUES(${destination},'2026-01',-300000,'2026-01-01','2026-01-01 09:00:00','transfer',100,'purchase','source');
  `);
  for (let month = 1; month <= 4; month++) {
    const date = `2026-0${month}-01`;
    for (const [category,amount,side] of [[1002,-10000,'source'],[destination,10000,'destination']] as const) {
      database.sqlite.query(`INSERT INTO budget_adjustment_logs(budget_category_id,year_month,amount,date,created_at,adjustment_type,
        depreciation_schedule_id,depreciation_event_key,depreciation_event_side) VALUES(?,?,?,?,?,'transfer',100,?,?)`)
        .run(category,date.slice(0,7),amount,date,'2026-01-01 10:00:00',`monthly:${month}`,side);
    }
  }
  return database;
}

async function availableAt(database:ReturnType<typeof createTestD1>,date:string,category:number) {
  const response = await budgetRouter.request(`/summary?year_month=${date.slice(0,7)}&as_of=${date}`,{}, {DB:database.DB});
  expect(response.status).toBe(200);
  const body = await response.json() as {categories:{category:{id:number};available:number}[]};
  return body.categories.find(row=>row.category.id===category)!.available;
}

for (const method of ['assigned','special'] as const) {
  test(`${method}: three receipts survive a living-budget reset and April transfers only ten thousand`, async()=>{
    const database = seededPlan(method);
    const destination=method==='special'?1003:1001;
    expect(await availableAt(database,'2026-03-15',destination)).toBe(method==='special'?-270000:30000);
    const reset=await request(database,'/allocations',{budget_category_id:1002,year_month:'2026-03',date:'2026-03-15',
      adjustment_type:'reset',adhoc_delta:-70000,
      depreciation_decisions:[{schedule_id:100,action:method==='special'?'carry':'continue'}]});
    expect(reset.status).toBe(200);
    expect((await request(database,'/allocations',{budget_category_id:1002,year_month:'2026-03',date:'2026-03-16',adhoc_delta:50000})).status).toBe(200);
    expect(await availableAt(database,'2026-03-31',destination)).toBe(method==='special'?-270000:30000);
    expect(await availableAt(database,'2026-04-01',1002)).toBe(40000);
    expect(await availableAt(database,'2026-04-01',destination)).toBe(method==='special'?-260000:40000);
    expect(database.sqlite.query("SELECT SUM(amount) AS n FROM budget_adjustment_logs WHERE depreciation_schedule_id=100 AND amount>0 AND date<='2026-03-31'").get()).toEqual({n:30000});
  });
}

test('special reset carries debt by default and explicit settlement clears it with a paired source',async()=>{
  const database=seededPlan('special');
  const base={budget_category_id:1003,year_month:'2026-03',date:'2026-03-15',adjustment_type:'reset',adhoc_delta:270000};
  expect((await request(database,'/allocations',base)).status).toBe(200);
  expect(await availableAt(database,'2026-03-31',1003)).toBe(-270000);
  const response=await request(database,'/allocations',{...base,depreciation_decisions:[{schedule_id:100,action:'settle',settlement_source_category_id:1001}]});
  expect(response.status).toBe(200);
  expect(await availableAt(database,'2026-04-01',1003)).toBe(0);
  expect(await availableAt(database,'2026-04-01',1001)).toBe(30000);
  expect(database.sqlite.query("SELECT count(*) AS n FROM budget_adjustment_logs WHERE depreciation_schedule_id=100 AND date>'2026-03-15'").get()).toEqual({n:0});
});

test('ending assigned reimbursement preserves receipts and outstanding burden without a new transfer',async()=>{
  const database=seededPlan('assigned');
  const response=await request(database,'/allocations',{budget_category_id:1001,year_month:'2026-03',date:'2026-03-15',adjustment_type:'reset',adhoc_delta:-30000,
    depreciation_decisions:[{schedule_id:100,action:'end'}]});
  expect(response.status).toBe(200);
  expect(await availableAt(database,'2026-04-01',1001)).toBe(0);
  expect(await availableAt(database,'2026-04-01',1002)).toBe(70000);
  expect(database.sqlite.query("SELECT SUM(amount) AS n FROM budget_adjustment_logs WHERE depreciation_schedule_id=100 AND amount>0").get()).toEqual({n:30000});
});

test('an ended special plan still carries its unsettled negative budget through later resets',async()=>{
  const database=seededPlan('special');
  database.sqlite.exec("UPDATE depreciation_schedules SET budget_settings=json_set(budget_settings,'$.end_date','2026-03-01') WHERE id=100");
  const response=await request(database,'/allocations',{budget_category_id:1003,year_month:'2026-03',date:'2026-03-15',adjustment_type:'reset',adhoc_delta:270000});
  expect(response.status).toBe(200);
  expect(await availableAt(database,'2026-03-31',1003)).toBe(-270000);
  expect(database.sqlite.query("SELECT count(*) AS n FROM budget_adjustment_logs WHERE adjustment_type='reset'").get()).toEqual({n:0});
});

test('a plan configured between an archive check and its write makes that write stale',async()=>{
  const database=seededPlan('assigned');
  database.sqlite.exec("INSERT INTO budget_categories(id,name) VALUES(1004,'Future source')");
  const original=database.DB.batch.bind(database.DB);
  let raced=false;
  database.DB.batch=(async (statements:D1PreparedStatement[])=>{
    if (!raced) { raced=true; database.sqlite.exec("UPDATE depreciation_schedules SET budget_settings=json_set(budget_settings,'$.monthly_source_category_id',1004) WHERE id=100"); }
    return original(statements);
  }) as typeof database.DB.batch;
  const response=await request(database,'/categories/1004',{is_archived:true});
  expect(response.status).toBe(409);
  expect(database.sqlite.query('SELECT is_archived FROM budget_categories WHERE id=1004').get()).toEqual({is_archived:0});
});

test('a plan configured after a generic journal delete check cannot lose its source purchase',async()=>{
  const database=seededPlan('assigned');
  database.sqlite.exec('UPDATE depreciation_schedules SET budget_method=NULL WHERE id=100');
  const original=database.DB.batch.bind(database.DB);
  let raced=false;
  database.DB.batch=(async (statements:D1PreparedStatement[])=>{
    if (!raced) { raced=true; database.sqlite.exec("UPDATE depreciation_schedules SET budget_method='assigned' WHERE id=100"); }
    return original(statements);
  }) as typeof database.DB.batch;
  expect((await journalRouter.request('/7000',{method:'DELETE'},{DB:database.DB})).status).toBe(409);
  expect(database.sqlite.query('SELECT count(*) AS n FROM journal_entries WHERE id=7000').get()).toEqual({n:1});
});

test("reset requires an explicit continue/end decision for an affected assigned plan", async () => {
  const database = await fixture();
  const response = await request(database, "/allocations", {
    budget_category_id: 1001, year_month: "2026-04", date: "2026-04-15",
    adjustment_type: "reset", adhoc_delta: 0,
  });
  expect(response.status).toBe(409);
  expect(database.sqlite.query("SELECT count(*) AS n FROM budget_adjustment_logs WHERE adjustment_type='reset'").get()).toEqual({ n: 0 });
});

test("an unrelated reset does not require plan decisions", async () => {
  const database = await fixture();
  database.sqlite.exec("INSERT INTO budget_categories(id,name) VALUES(1003,'Unrelated')");
  const response = await request(database, "/allocations", {
    budget_category_id: 1003, year_month: "2026-04", date: "2026-04-15",
    adjustment_type: "reset", adhoc_delta: 0,
  });
  expect(response.status).toBe(200);
});

test("active plan categories cannot disappear through archive or deletion", async () => {
  const database = await fixture();
  expect((await request(database, "/categories/1001", { is_archived: true })).status).toBe(409);
  expect((await budgetRouter.request("/categories/1002", { method: "DELETE" }, { DB: database.DB })).status).toBe(409);
  expect(database.sqlite.query("SELECT count(*) AS n FROM budget_categories WHERE id IN (1001,1002)").get()).toEqual({ n: 2 });
});

test("owned purchase and transfer rows cannot be edited or deleted one side at a time", async () => {
  const database = await fixture();
  const row = database.sqlite.query("SELECT id FROM budget_adjustment_logs WHERE journal_entry_id IS NOT NULL LIMIT 1").get() as { id: number } | null;
  expect(row).not.toBeNull();
  expect((await request(database, `/adjustment-logs/${row!.id}`, { amount: 1 })).status).toBe(409);
  expect((await budgetRouter.request(`/adjustment-logs/${row!.id}`, { method: "DELETE" }, { DB: database.DB })).status).toBe(409);
});

test("generic journal and bulk deletion protect configured depreciation accounting", async () => {
  const database = await fixture();
  const monthly = database.sqlite.query("SELECT journal_entry_id AS id FROM depreciation_entries LIMIT 1").get() as {id:number};
  expect((await journalRouter.request(`/${monthly.id}`,{method:"DELETE"},{DB:database.DB})).status).toBe(409);
  const response = await journalRouter.request("/bulk-delete",{method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({entry_ids:[monthly.id]})},{DB:database.DB});
  expect(response.status).toBe(409);
});

test('a reset referenced by saved plan decisions cannot be deleted or moved independently',async()=>{
  const database=seededPlan('assigned');
  const reset=await request(database,'/allocations',{budget_category_id:1001,year_month:'2026-03',date:'2026-03-15',
    adjustment_type:'reset',adhoc_delta:-30000,depreciation_decisions:[{schedule_id:100,action:'continue'}]});
  expect(reset.status).toBe(200);
  const row=database.sqlite.query("SELECT id FROM budget_adjustment_logs WHERE adjustment_type='reset'").get() as {id:number};
  expect((await request(database,`/adjustment-logs/${row.id}`,{date:'2026-03-16'})).status).toBe(409);
  expect((await budgetRouter.request(`/adjustment-logs/${row.id}`,{method:'DELETE'},{DB:database.DB})).status).toBe(409);
  expect((await request(database,`/adjustment-logs/${row.id}`,{note:'Reviewed reset'})).status).toBe(200);
  expect(database.sqlite.query('SELECT date,note FROM budget_adjustment_logs WHERE id=?').get(row.id))
    .toEqual({date:'2026-03-15',note:'Reviewed reset'});
});

test('explicit erase-all clears retained depreciation audit data',async()=>{
  const database=await fixture();
  expect(database.sqlite.query('SELECT count(*) AS n FROM depreciation_budget_revisions').get()).toEqual({n:1});
  const response=await adminRouter.request('/erase',{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({scope:'all_data'})},{DB:database.DB});
  expect(response.status).toBe(200);
  expect(database.sqlite.query('SELECT count(*) AS n FROM depreciation_budget_revisions').get()).toEqual({n:0});
});

test("a continue reset rejects a full before-and-after audit row before writing", async () => {
  const database = createTestD1();
  databases.push(database);
  database.sqlite.exec(`
    INSERT INTO accounts(id,name,type,category,is_depreciable) VALUES
      (1001,'Bank','asset','cash',0),(1002,'Equipment','asset','property',1),
      (1003,'Expense','expense','other',0);
    INSERT INTO budget_categories(id,name) VALUES
      (1001,'Purchase'),(1002,'Source A'),(1004,'Source B'),(1005,'Source C'),(1006,'Source D');
  `);
  const settings = {
    method: "assigned",
    purchase_category_id: 1001,
    monthly_source_allocations: [
      { budget_category_id: 1002, ratio: 25 },
      { budget_category_id: 1004, ratio: 25 },
      { budget_category_id: 1005, ratio: 25 },
      { budget_category_id: 1006, ratio: 25 },
    ],
  };
  const created = await depreciationRouter.request("/", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ purchase_date: "2027-01-01", description: "Large plan",
      asset_account_id: 1002, payment_account_id: 1001, expense_account_id: 1003,
      total_amount: 260_000_000_000_000, months: 530, currency: "JPY",
      idempotency_key: crypto.randomUUID(), budget_settings: settings }),
  }, { DB: database.DB });
  expect(created.status).toBe(201);
  const { schedule_id: scheduleId } = await created.json() as { schedule_id: number };
  const before = {
    schedule: database.sqlite.query(`SELECT budget_revision,budget_settings FROM depreciation_schedules WHERE id=?`).get(scheduleId),
    logs: database.sqlite.query(`SELECT count(*) AS count FROM budget_adjustment_logs WHERE depreciation_schedule_id=?`).get(scheduleId),
    audits: database.sqlite.query(`SELECT count(*) AS count FROM depreciation_budget_revisions WHERE schedule_id=?`).get(scheduleId),
    resets: database.sqlite.query(`SELECT count(*) AS count FROM budget_adjustment_logs WHERE adjustment_type='reset'`).get(),
  };
  const reset = await request(database, "/allocations", {
    budget_category_id: 1002, year_month: "2026-12", date: "2026-12-01", currency: "JPY",
    adhoc_delta: 0, adjustment_type: "reset",
    depreciation_decisions: [{ schedule_id: scheduleId, action: "continue" }],
  });
  expect(reset.status).toBe(400);
  expect(await reset.json()).toMatchObject({ error: "depreciation_budget_plan_too_large" });
  expect(database.sqlite.query(`SELECT budget_revision,budget_settings FROM depreciation_schedules WHERE id=?`).get(scheduleId))
    .toEqual(before.schedule);
  expect(database.sqlite.query(`SELECT count(*) AS count FROM budget_adjustment_logs WHERE depreciation_schedule_id=?`).get(scheduleId))
    .toEqual(before.logs);
  expect(database.sqlite.query(`SELECT count(*) AS count FROM depreciation_budget_revisions WHERE schedule_id=?`).get(scheduleId))
    .toEqual(before.audits);
  expect(database.sqlite.query(`SELECT count(*) AS count FROM budget_adjustment_logs WHERE adjustment_type='reset'`).get())
    .toEqual(before.resets);
});
