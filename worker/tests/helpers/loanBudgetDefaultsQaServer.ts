import app from "../../src/index";
import { createLoanManagementBudgetFixture } from "./loanManagementBudgetFixture";

function createFixture() {
  const value = createLoanManagementBudgetFixture();
  value.sqlite.exec(`
    DELETE FROM budget_funding_allocations WHERE journal_entry_id IN(9003,9004,9103,9104);
    DELETE FROM journal_lines WHERE journal_entry_id IN(9003,9004,9103,9104);
    DELETE FROM journal_entries WHERE id IN(9003,9004,9103,9104);
    DELETE FROM budget_funding_allocations WHERE journal_entry_id IN(9001,9002,9101,9102);
    INSERT INTO budget_funding_allocations(journal_entry_id,budget_category_id,kind,amount,currency,effect) VALUES
      (9001,1001,'lend',50000,'JPY','apply'),(9001,1002,'lend',25000,'JPY','apply'),(9001,NULL,'lend',25000,'JPY','apply'),
      (9002,1001,'borrow',50000,'JPY','apply'),(9002,1002,'borrow',25000,'JPY','apply'),(9002,NULL,'borrow',25000,'JPY','apply'),
      (9101,1001,'lend',33333,'USD','apply'),(9101,1002,'lend',66667,'USD','apply'),
      (9102,1001,'borrow',33333,'USD','apply'),(9102,1002,'borrow',66667,'USD','apply');
    UPDATE budget_categories SET is_archived=1 WHERE id=1002;
    INSERT INTO accounts(id,name,type,category,include_in_allocatable)
      VALUES(1015,'端数貸付テスト','asset','long_term_lending',0);
    INSERT INTO journal_entries(id,date,description) VALUES(9200,'2026-11-02','端数貸付元本');
    INSERT INTO journal_lines(journal_entry_id,account_id,debit,credit,currency)
      VALUES(9200,1015,2,0,'JPY'),(9200,1001,0,2,'JPY');
    INSERT INTO budget_funding_allocations(journal_entry_id,budget_category_id,kind,amount,currency,effect)
      VALUES(9200,1001,'lend',1,'JPY','apply'),(9200,1002,'lend',1,'JPY','apply');
  `);
  return value;
}
let fixture = createFixture();
const port = Number(process.env.LOAN_DEFAULTS_QA_PORT ?? 18787);
const server = Bun.serve({
  hostname: "127.0.0.1", port,
  fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/__loan-defaults-qa") return Response.json({ isolated: true });
    if (path === "/__loan-defaults-reset" && request.method === "POST") {
      fixture.close();
      fixture = createFixture();
      return Response.json({ isolated: true });
    }
    return app.fetch(request, { DB: fixture.DB, DISABLE_ADMIN_API: "1" });
  },
});
console.log(`Isolated loan default QA API: ${server.url}`);
