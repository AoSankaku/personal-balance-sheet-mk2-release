import app from "../../src/index";
import { createTestD1 } from "./d1";

function createFixture() {
  const fixture = createTestD1();
  fixture.sqlite.exec(`
    INSERT OR IGNORE INTO enabled_currencies(code,decimal_places) VALUES('JPY',0),('USD',2);
    INSERT INTO accounts(id,name,type,category,include_in_allocatable,deduct_from_budget) VALUES
      (1001,'メイン口座','asset','cash',1,0),
      (1002,'非追跡現金','asset','cash',0,0),
      (1003,'事業立替金','asset','business_advance',0,0),
      (1004,'事業損失','expense','other',0,0),
      (1005,'生活費用','expense','food',0,0),
      (1006,'初期残高','equity','opening_balance',0,0);
    INSERT INTO budget_categories(id,name) VALUES(1001,'事業用予算'),(1002,'生活予算');
    INSERT INTO budget_category_accounts(budget_category_id,account_id,ratio) VALUES(1002,1005,100),(1002,1004,100);
    INSERT OR IGNORE INTO budget_settings(id) VALUES(1);
    UPDATE budget_settings SET is_business_owner=1,business_advance_account_id=1003,
      business_loss_account_id=1004,business_advance_budget_category_id=1001,
      preferred_payment_account_ids='[1001]' WHERE id=1;
    INSERT INTO journal_entries(id,date,description) VALUES(900,'2026-11-01','検証用初期残高');
    INSERT INTO journal_lines(journal_entry_id,account_id,debit,credit,currency) VALUES
      (900,1001,50000,0,'JPY'),(900,1002,10000,0,'JPY'),(900,1006,0,60000,'JPY'),
      (900,1001,5000000,0,'USD'),(900,1002,1000000,0,'USD'),(900,1006,0,6000000,'USD');
    INSERT INTO budget_adjustment_logs(budget_category_id,year_month,amount,currency,date,adjustment_type) VALUES
      (1001,'2026-11',10000,'JPY','2026-11-01','allocation'),
      (1002,'2026-11',10000,'JPY','2026-11-01','allocation'),
      (1001,'2026-11',1000000,'USD','2026-11-01','allocation'),
      (1002,'2026-11',1000000,'USD','2026-11-01','allocation');
  `);
  return fixture;
}
let fixture = createFixture();
const port = Number(process.env.BUSINESS_ADVANCE_QA_PORT ?? 18821);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid QA port");
const server = Bun.serve({
  hostname: "127.0.0.1", port,
  fetch: request => {
    const path = new URL(request.url).pathname;
    if (path === "/__business-advance-qa") return Response.json({ isolated: true });
    if (path === "/__business-advance-reset" && request.method === "POST") {
      fixture.close();
      fixture = createFixture();
      return Response.json({ isolated: true, reset: true });
    }
    return app.fetch(request, { DB: fixture.DB, DISABLE_ADMIN_API: "1" });
  },
});
console.log(`Isolated business advance QA API: ${server.url}`);
