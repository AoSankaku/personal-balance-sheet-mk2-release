/** Disposable browser-QA API. Uses only an in-memory DB; never opens local D1. */
import app from "../../src/index";
import { createTestD1 } from "./d1";

const h=createTestD1();
h.sqlite.exec(`
  INSERT INTO enabled_currencies(code,decimal_places) VALUES('JPY',0);
  INSERT INTO accounts(id,name,type,category,is_depreciable) VALUES
    (1001,'テスト銀行','asset','cash',0),(1002,'テスト機器','asset','property',1),
    (1003,'減価償却費','expense','other',0),(1004,'初期残高','equity','opening_balance',0),
    (1005,'別の償却費','expense','other',0);
  INSERT INTO budget_categories(id,name) VALUES(1001,'貯蓄'),(1002,'生活費'),(1003,'仕事費');
  INSERT INTO budget_category_accounts(budget_category_id,account_id,ratio) VALUES
    (1002,1003,60),(1003,1003,40),(1002,1005,25),(1003,1005,75);
  INSERT INTO journal_entries(id,date,description,created_at) VALUES
    (7000,'2026-06-01','テスト初期残高','2026-06-01 09:00:00'),
    (7001,'2026-07-01','修正テスト用の機器','2026-07-01 09:00:00');
  INSERT INTO journal_lines(journal_entry_id,account_id,debit,credit) VALUES
    (7000,1001,1000000,0),(7000,1004,0,1000000),
    (7001,1002,300000,0),(7001,1001,0,300000);
  INSERT INTO depreciation_schedules(id,source_journal_entry_id,asset_account_id,expense_account_id,total_amount,months,start_date,description)
    VALUES(100,7001,1002,1003,300000,30,'2026-07-01','修正テスト用の機器');
  INSERT INTO budget_adjustment_logs(budget_category_id,year_month,amount,date,created_at,adjustment_type) VALUES
    (1001,'2026-06',300000,'2026-06-01','2026-06-01 09:00:00','allocation'),
    (1002,'2026-06',100000,'2026-06-01','2026-06-01 09:00:00','allocation'),
    (1001,'2026-08',-300000,'2026-08-15','2026-08-15 09:00:00','reset'),
    (1002,'2026-08',-100000,'2026-08-15','2026-08-15 09:00:00','reset'),
    (1002,'2026-09',50000,'2026-09-01','2026-09-01 09:00:00','allocation');
`);
for(let month=1;month<=30;month++) {
  const date=new Date(Date.UTC(2026,5+month,1)).toISOString().slice(0,10);
  const id=7100+month;
  h.sqlite.query("INSERT INTO journal_entries(id,date,description,created_at) VALUES(?,?,?,'2026-07-01 10:00:00')")
    .run(id,date,`テスト償却 ${month}`);
  h.sqlite.query("INSERT INTO journal_lines(journal_entry_id,account_id,debit,credit) VALUES(?,1003,10000,0),(?,1002,0,10000)").run(id,id);
  h.sqlite.query("INSERT INTO depreciation_entries(schedule_id,journal_entry_id,month_number) VALUES(100,?,?)").run(id,month);
}
const port = Number(process.env.DEPRECIATION_QA_PORT ?? 8787);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid QA port");
const server=Bun.serve({hostname:"127.0.0.1",port,fetch:request=>
  new URL(request.url).pathname === "/__depreciation-budget-qa"
    ? Response.json({ isolated: true, monthlySources: true })
    : app.fetch(request,{DB:h.DB,DISABLE_ADMIN_API:"1"})});
console.log(`Isolated depreciation QA API: ${server.url}`);
