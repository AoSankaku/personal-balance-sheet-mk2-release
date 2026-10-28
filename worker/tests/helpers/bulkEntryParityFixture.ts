import { createIncomeBudgetScopeFixture } from "./incomeBudgetScopeFixture";

/** Synthetic multi-currency openings shared by input-path and API verification. */
export function createBulkEntryParityFixture() {
  const fixture = createIncomeBudgetScopeFixture();
  fixture.sqlite.exec(`
    INSERT INTO enabled_currencies(code,decimal_places) VALUES('USD',2);
    UPDATE accounts SET name='割引・利息収入' WHERE id=1005;
    INSERT INTO accounts(id,name,type,category,include_in_allocatable,deduct_from_budget) VALUES
      (1010,'短期借入テスト','liability','short_term_loan',1,0),
      (1011,'短期貸付テスト','asset','short_term_lending',0,0);
    INSERT INTO journal_entries(id,date,description,created_at) VALUES
      (9100,'2026-10-02','JPY借入の開始','2026-10-02 10:00:00'),
      (9101,'2026-10-02','USD借入の開始','2026-10-02 10:00:00'),
      (9102,'2026-10-02','JPY貸付の開始','2026-10-02 10:00:00'),
      (9103,'2026-10-01','USD初期残高','2026-10-01 10:00:00');
    INSERT INTO journal_lines(journal_entry_id,account_id,debit,credit,currency) VALUES
      (9100,1001,200,0,'JPY'),(9100,1010,0,200,'JPY'),
      (9101,1001,2000,0,'USD'),(9101,1010,0,2000,'USD'),
      (9102,1011,30,0,'JPY'),(9102,1001,0,30,'JPY'),
      (9103,1001,100000,0,'USD'),(9103,1008,0,100000,'USD');
    INSERT INTO loan_settlements(journal_entry_id,is_settled) VALUES(9100,0),(9101,0),(9102,0);
    INSERT INTO budget_funding_allocations(journal_entry_id,budget_category_id,kind,amount,currency,effect) VALUES
      (9100,1001,'borrow',200,'JPY','apply'),(9101,1001,'borrow',2000,'USD','apply'),
      (9102,1001,'lend',30,'JPY','apply');
    INSERT INTO budget_adjustment_logs(budget_category_id,year_month,amount,currency,date,adjustment_type)
      VALUES(1001,'2026-10',10000,'USD','2026-10-01','allocation');
  `);
  return fixture;
}
