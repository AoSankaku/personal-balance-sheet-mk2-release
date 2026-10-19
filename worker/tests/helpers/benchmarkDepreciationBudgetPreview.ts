/** Isolated in-memory benchmark; never opens local or production D1.
 * Usage: bun worker/tests/helpers/benchmarkDepreciationBudgetPreview.ts special 30 6 5 1
 * Args: method, accounting months, reset count, artificial latency ms, repetitions.
 */
import { createTestD1 } from './d1';
import { depreciationRouter } from '../../src/routes/depreciation';
import type { DepreciationBudgetSettings } from '../../../shared/depreciationBudget';

const method = (process.argv[2] ?? 'assigned') as 'assigned'|'special';
const monthCount = Number(process.argv[3] ?? 30);
const resetCount = Number(process.argv[4] ?? 6);
const latency = Number(process.argv[5] ?? 0);
const repetitions = Number(process.argv[6] ?? 1);
if(!['assigned','special'].includes(method)||!Number.isInteger(monthCount)||monthCount<2||monthCount>480||
 !Number.isInteger(resetCount)||resetCount<0||resetCount>120||!Number.isInteger(latency)||latency<0||latency>100||
 !Number.isInteger(repetitions)||repetitions<1||repetitions>5)throw new Error('Benchmark arguments exceed bounded fixture limits');
const startDate=monthCount>30?'2016-11-01':'2024-05-01';
const monthDate=(offset:number)=>{const d=new Date(`${startDate}T00:00:00Z`);d.setUTCMonth(d.getUTCMonth()+offset);return d.toISOString().slice(0,10);};
const h=createTestD1({maxParameters:process.env.ENFORCE_D1_PARAMETERS==='1'?100:undefined});
h.sqlite.exec(`INSERT INTO accounts(id,name,type,category,include_in_allocatable,is_depreciable,deduct_from_budget) VALUES
 (1001,'Bank','asset','cash',1,0,0),(1002,'Equipment','asset','property',0,1,0),
 (1003,'Depreciation expense','expense','other',1,0,0),(1004,'Opening balance','equity','opening_balance',1,0,0);
 INSERT INTO budget_categories(id,name) VALUES(1001,'Purchase reserve'),(1002,'Monthly source'),(1003,'Special');
 INSERT INTO journal_entries(id,date,description,created_at) VALUES(900,'2016-10-31','Opening','2016-10-31 08:00:00');
 INSERT INTO journal_lines(journal_entry_id,account_id,debit,credit,currency) VALUES(900,1001,1000000,0,'JPY'),(900,1004,0,1000000,'JPY');
 INSERT INTO budget_adjustment_logs(budget_category_id,year_month,amount,currency,date,created_at,adjustment_type) VALUES
 (1001,'2016-10',300000,'JPY','2016-10-31','2016-10-31 09:00:00','allocation'),(1002,'2016-10',100000,'JPY','2016-10-31','2016-10-31 09:00:00','allocation');`);
h.sqlite.query(`INSERT INTO journal_entries(id,date,description,created_at) VALUES(901,?,'Purchase',?)`).run(startDate,`${startDate} 08:00:00`);
h.sqlite.exec(`INSERT INTO journal_lines(journal_entry_id,account_id,debit,credit,currency) VALUES(901,1002,300000,0,'JPY'),(901,1001,0,300000,'JPY')`);
if(monthCount<=30)h.sqlite.exec(`UPDATE budget_adjustment_logs SET year_month='2024-04',date='2024-04-30',created_at='2024-04-30 09:00:00'`);
const scheduleId=Number((h.sqlite.query(`INSERT INTO depreciation_schedules(source_journal_entry_id,asset_account_id,expense_account_id,total_amount,months,start_date,description,budget_currency,budget_special_category_id)
 VALUES(901,1002,1003,300000,?,?,'Equipment','JPY',?) RETURNING id`).get(monthCount,startDate,method==='special'?1003:null) as {id:number}).id);
for(let i=0;i<monthCount;i++){
 const date=monthDate(i),id=902+i,amount=Math.floor(300000/monthCount)+(i<300000%monthCount?1:0);
 h.sqlite.query(`INSERT INTO journal_entries(id,date,description,created_at) VALUES(?,?,'Depreciation',?)`).run(id,date,`${date} 10:00:00`);
 h.sqlite.query(`INSERT INTO journal_lines(journal_entry_id,account_id,debit,credit,currency) VALUES(?,1003,?,0,'JPY'),(?,1002,0,?,'JPY')`).run(id,amount,id,amount);
 h.sqlite.query(`INSERT INTO depreciation_entries(schedule_id,journal_entry_id,month_number) VALUES(?,?,?)`).run(scheduleId,id,i+1);
}
const decisions:NonNullable<DepreciationBudgetSettings['reset_decisions']>=[];
for(let i=0;i<resetCount;i++){
 const date=monthDate(Math.floor((i+1)*(monthCount-1)/(resetCount+1))).slice(0,7)+'-15';
 const id=Number((h.sqlite.query(`INSERT INTO budget_adjustment_logs(budget_category_id,year_month,amount,currency,date,created_at,adjustment_type,reset_scope)
 VALUES(?,?,0,'JPY',?,?,'reset','category') RETURNING id`).get(method==='special'?1003:1002,date.slice(0,7),date,`${date} 12:00:00`) as {id:number}).id);
 decisions.push({reset_log_id:id,action:method==='special'?'carry':'continue'});
}
const settings:DepreciationBudgetSettings=method==='assigned'?{method,purchase_category_id:1001,monthly_source_category_id:1002,reset_decisions:decisions}:{method,monthly_source_category_id:1002,reset_decisions:decisions};
let statements=0;let dbElapsedMs=0;const queryCounts=new Map<string,number>();const exactQueries=new Set<string>();
const wrapStatement=(statement:any):any=>new Proxy(statement,{get(target,key){
 if(key==='bind')return(...args:any[])=>wrapStatement(target.bind(...args));
 if(['all','first','raw','run'].includes(String(key)))return async(...args:any[])=>{
  statements++;queryCounts.set(target.query,(queryCounts.get(target.query)??0)+1);exactQueries.add(JSON.stringify([key,target.query,target.parameters]));
  if(latency)await Bun.sleep(latency);
  const began=performance.now();try{return await target[key](...args);}finally{dbElapsedMs+=performance.now()-began;}
 };
 const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
}});
const DB={...h.DB,prepare:(query:string)=>wrapStatement(h.DB.prepare(query))} as D1Database;
try{
for(let repetition=0;repetition<repetitions;repetition++){
 statements=0;dbElapsedMs=0;queryCounts.clear();exactQueries.clear();const began=performance.now();
 const response=await depreciationRouter.request(`/${scheduleId}/budget/preview`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({settings})},{DB});
 const body=await response.json() as any;const wallMs=performance.now()-began;
 console.log(JSON.stringify({method,monthCount,resetCount,latency,repetition,status:response.status,wallMs:Number(wallMs.toFixed(2)),dbElapsedMs:Number(dbElapsedMs.toFixed(2)),statements,uniqueExactQueries:exactQueries.size,timeline:body.timeline?.length,boundaries:body.boundaries?.length,changes:body.changes?.length,warnings:body.warnings,can_apply:body.can_apply,error:body.error,topQueries:[...queryCounts].sort((a,b)=>b[1]-a[1]).slice(0,8).map(([sql,count])=>({count,sql:sql.replace(/\s+/g,' ').slice(0,300)}))}));
}
}finally{h.close();}
