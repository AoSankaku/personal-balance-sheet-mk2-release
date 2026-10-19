import { afterEach, expect, test } from "bun:test";
import { createTestD1 } from "./helpers/d1";
import { depreciationRouter } from "../src/routes/depreciation";
import { budgetRouter } from "../src/routes/budget";
import { accountsRouter } from "../src/routes/accounts";
import { sumBudgetResourceBalances } from "../../shared/budgetScope";
import type { DepreciationBudgetSettings, DepreciationBudgetPreview } from "../../shared/depreciationBudget";

const handles:ReturnType<typeof createTestD1>[]=[];
afterEach(()=>{for(const h of handles.splice(0))h.close();});
function fixture() {
  const h=createTestD1();handles.push(h);
  h.sqlite.exec(`INSERT INTO accounts(id,name,type,category,is_depreciable,include_in_allocatable) VALUES
    (1001,'Bank','asset','cash',0,1),(1002,'Equipment','asset','property',1,0),
    (1003,'Depreciation','expense','other',0,1),(1004,'Opening','equity','opening_balance',0,1),
    (1005,'Excluded','asset','cash',0,0);
    INSERT INTO budget_categories(id,name) VALUES(1001,'Savings'),(1002,'Living');
    INSERT INTO journal_entries(id,date,description,created_at) VALUES(900,'2025-12-31','Opening','2025-12-31 00:00:00');
    INSERT INTO journal_lines(journal_entry_id,account_id,debit,credit) VALUES(900,1001,1000000,0),(900,1004,0,1000000);
    INSERT INTO budget_adjustment_logs(budget_category_id,year_month,amount,date,created_at) VALUES
      (1001,'2025-12',300000,'2025-12-31','2025-12-31 01:00:00'),(1002,'2025-12',100000,'2025-12-31','2025-12-31 01:00:00');`);
  return h;
}
function dep(h:ReturnType<typeof fixture>,path:string,body:unknown,method='POST') {
  return depreciationRouter.request(path,{method,headers:{'content-type':'application/json'},body:JSON.stringify(body)},{DB:h.DB});
}
function settings(method:DepreciationBudgetSettings['method']):DepreciationBudgetSettings {
  return {method,purchase_category_id:method==='assigned'?1001:null,monthly_source_category_id:method==='unallocated'?null:1002,confirm_unallocated:method==='unallocated'};
}
async function create(h:ReturnType<typeof fixture>,method:DepreciationBudgetSettings['method']) {
  const response=await dep(h,'/',{purchase_date:'2026-01-01',description:'Equipment',asset_account_id:1002,payment_account_id:1001,
    expense_account_id:1003,total_amount:300000,months:30,idempotency_key:crypto.randomUUID(),budget_settings:settings(method)});
  expect(response.status).toBe(201);
  return (await response.json() as {schedule_id:number}).schedule_id;
}
async function snapshot(h:ReturnType<typeof fixture>,date:string) {
  const accountResponse=await accountsRouter.request(`/?as_of=${date}`,{},{DB:h.DB});
  const T=sumBudgetResourceBalances(await accountResponse.json() as Parameters<typeof sumBudgetResourceBalances>[0],'JPY');
  const budgetResponse=await budgetRouter.request(`/summary?year_month=${date.slice(0,7)}&as_of=${date}`,{},{DB:h.DB});
  expect(budgetResponse.status).toBe(200);
  const budget=await budgetResponse.json() as {categories:{category:{id:number};available:number}[]};
  const balances=Object.fromEntries(budget.categories.map(row=>[row.category.id,row.available]));
  const B=Object.values(balances).reduce((a,b)=>a+b,0),D=Object.values(balances).reduce((a,b)=>a+Math.max(-b,0),0);
  return {T,U:T-B,D,allocatable:T-B-D,balances};
}
async function preview(h:ReturnType<typeof fixture>,id:number,config:DepreciationBudgetSettings) {
  const response=await dep(h,`/${id}/budget/preview`,{settings:config});
  expect(response.status).toBe(200);
  return await response.json() as DepreciationBudgetPreview;
}

for(const method of ['assigned','special','unallocated'] as const) {
  test(`${method}: exact 300000 purchase and 10000 monthly T/U/category effects`,async()=>{
    const h=fixture(),id=await create(h,method);
    const january=await snapshot(h,'2026-01-01'),february=await snapshot(h,'2026-02-01');
    expect(january.T).toBe(700000);expect(february.T).toBe(700000);
    expect(january.U).toBe(method==='unallocated'?300000:600000);
    expect(february.U).toBe(january.U);
    expect(january.balances[1002]).toBe(method==='unallocated'?100000:90000);
    expect(february.balances[1002]).toBe(method==='unallocated'?100000:80000);
    if(method==='assigned') {expect(january.balances[1001]).toBe(10000);expect(february.balances[1001]).toBe(20000);}
    if(method==='special') {
      const row=h.sqlite.query('SELECT budget_special_category_id AS id FROM depreciation_schedules WHERE id=?').get(id) as {id:number};
      expect(january.balances[row.id]).toBe(-290000);expect(february.balances[row.id]).toBe(-280000);
      expect(january.D).toBe(290000);expect(january.allocatable).toBe(310000);
    }
    expect(h.sqlite.query('SELECT count(*) AS n FROM journal_entry_budget_allocations').get()).toEqual({n:0});
  });
}

test('preview T and U use ledger resources at identical historic cutoffs and no-op repair has no effects',async()=>{
  const h=fixture(),id=await create(h,'assigned');
  const p=await preview(h,id,settings('assigned'));
  expect(p.can_apply).toBe(true);expect(p.changes).toEqual([]);
  for(const point of p.timeline) {
    expect(point.before.T).toBe(700000);expect(point.after.T).toBe(700000);
    expect(point.before.U).toBe(600000);expect(point.after.U).toBe(600000);
    expect(point.before).toEqual(point.after);
  }
  const count=h.sqlite.query('SELECT count(*) AS n FROM depreciation_budget_revisions').get();
  expect((await dep(h,`/${id}/budget/apply`,{token:p.token,settings:p.settings,confirmed:true})).status).toBe(200);
  expect(h.sqlite.query('SELECT count(*) AS n FROM depreciation_budget_revisions').get()).toEqual(count);
});

test('historical end decision stops future budget transfers while preserving accounting',async()=>{
  const h=fixture(),id=await create(h,'assigned');
  h.sqlite.exec("INSERT INTO budget_adjustment_logs(id,budget_category_id,year_month,amount,date,created_at,adjustment_type,reset_scope) VALUES(2000,1001,'2026-03',-30000,'2026-03-15','2026-03-15 12:00:00','reset','category')");
  const config={...settings('assigned'),reset_decisions:[{reset_log_id:2000,action:'end' as const}]};
  const p=await preview(h,id,config);expect(p.can_apply).toBe(true);
  expect(p.progress.reimbursed_amount).toBe(30000);expect(p.progress.remaining_amount).toBe(270000);expect(p.progress.future_amount).toBe(0);
  const journals=h.sqlite.query('SELECT count(*) AS n FROM journal_entries').get();
  expect((await dep(h,`/${id}/budget/apply`,{token:p.token,settings:p.settings,confirmed:true})).status).toBe(200);
  expect(h.sqlite.query('SELECT count(*) AS n FROM journal_entries').get()).toEqual(journals);
  expect(h.sqlite.query("SELECT count(*) AS n FROM budget_adjustment_logs WHERE depreciation_schedule_id=? AND depreciation_event_key LIKE 'monthly:%' AND date>'2026-03-15'").get(id)).toEqual({n:0});
});

test('full settlement after three receipts caps lifetime reimbursement and cannot resurrect future months',async()=>{
  const h=fixture(),id=await create(h,'special');
  const config={...settings('special'),settlements:[{key:'full',date:'2026-03-15',amount:270000,source_category_id:null}]};
  const p=await preview(h,id,config);expect(p.can_apply).toBe(true);
  expect(p.progress.reimbursed_amount).toBe(300000);expect(p.progress.remaining_amount).toBe(0);expect(p.progress.future_amount).toBe(0);
  expect((await dep(h,`/${id}/budget/apply`,{token:p.token,settings:p.settings,confirmed:true})).status).toBe(200);
  expect(h.sqlite.query("SELECT SUM(amount) AS n FROM budget_adjustment_logs WHERE depreciation_schedule_id=? AND amount>0 AND (depreciation_event_key LIKE 'monthly:%' OR depreciation_event_key LIKE 'settlement:%')").get(id)).toEqual({n:300000});
  expect((await preview(h,id,config)).changes).toEqual([]);
});

test('cancelled accounting months are not fabricated as budget receipts',async()=>{
  const h=fixture(),id=await create(h,'unallocated');
  h.sqlite.exec(`DELETE FROM journal_entries WHERE id IN (SELECT journal_entry_id FROM depreciation_entries WHERE schedule_id=${id})`);
  const p=await preview(h,id,settings('assigned'));
  expect(p.progress.reimbursed_amount).toBe(0);expect(p.progress.future_amount).toBe(0);expect(p.progress.remaining_amount).toBe(300000);
  expect(p.changes.filter(change=>change.event.kind==='monthly')).toEqual([]);
});

test('an injected mid-apply failure rolls back special creation, settings, all budget rows and audit',async()=>{
  const h=fixture(),id=await create(h,'unallocated');
  const p=await preview(h,id,settings('special'));expect(p.can_apply).toBe(true);
  const original=h.DB.batch.bind(h.DB),before=h.sqlite.query('SELECT * FROM depreciation_schedules WHERE id=?').get(id);
  h.DB.batch=(async(statements:D1PreparedStatement[])=>original([...statements.slice(0,4),h.DB.prepare('INSERT INTO missing_failure_table VALUES(1)'),...statements.slice(4)])) as typeof h.DB.batch;
  expect((await dep(h,`/${id}/budget/apply`,{token:p.token,settings:p.settings,confirmed:true})).status).toBe(500);
  expect(h.sqlite.query('SELECT * FROM depreciation_schedules WHERE id=?').get(id)).toEqual(before);
  expect(h.sqlite.query('SELECT count(*) AS n FROM budget_categories').get()).toEqual({n:2});
  expect(h.sqlite.query('SELECT count(*) AS n FROM budget_adjustment_logs WHERE depreciation_schedule_id=?').get(id)).toEqual({n:0});
  expect(h.sqlite.query('SELECT count(*) AS n FROM depreciation_budget_revisions WHERE schedule_id=?').get(id)).toEqual({n:1});
});

for(const operation of ['switch','delete'] as const) {
  test(`${operation} preserves unrelated manual funds in the old special category`,async()=>{
    const h=fixture(),id=await create(h,'special');
    const category=(h.sqlite.query('SELECT budget_special_category_id AS id FROM depreciation_schedules WHERE id=?').get(id) as {id:number}).id;
    h.sqlite.query("INSERT INTO budget_adjustment_logs(budget_category_id,year_month,amount,date) VALUES(?,'2026-01',50000,'2026-01-02')").run(category);
    if(operation==='switch') {
      const p=await preview(h,id,settings('unallocated'));expect(p.can_apply).toBe(true);
      expect((await dep(h,`/${id}/budget/apply`,{token:p.token,settings:p.settings,confirmed:true})).status).toBe(200);
      expect((await snapshot(h,'2026-10-19')).T).toBe(700000);
    } else expect((await depreciationRouter.request(`/${id}`,{method:'DELETE'},{DB:h.DB})).status).toBe(200);
    const after=await snapshot(h,'2026-10-19');
    expect(after.balances[category]).toBe(50000);
    expect(after.U).toBe(operation==='switch'?250000:550000);
  });
}
