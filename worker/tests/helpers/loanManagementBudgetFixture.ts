import { createTestD1 } from "./d1";

/** Synthetic data only; all writes remain in this disposable SQLite database. */
export function createLoanManagementBudgetFixture() {
  const fixture = createTestD1();
  fixture.sqlite.exec(`
    INSERT INTO enabled_currencies(code,decimal_places) VALUES ('JPY',0),('USD',2);
    INSERT INTO accounts(id,name,type,category,include_in_allocatable,deduct_from_budget) VALUES
      (1001,'テスト銀行','asset','cash',1,0),
      (1002,'受取利息','income','other',1,0),
      (1003,'支払利息','expense','other',1,0),
      (1004,'初期残高','equity','opening_balance',1,0),
      (1010,'長期貸付テスト','asset','long_term_lending',0,0),
      (1011,'長期借入テスト','liability','long_term_loan',0,0),
      (1012,'短期貸付テスト','asset','short_term_lending',0,0);
    INSERT INTO budget_categories(id,name) VALUES(1001,'生活費'),(1002,'積立');
    INSERT INTO budget_category_accounts(budget_category_id,account_id,ratio) VALUES(1001,1003,100);
    INSERT INTO budget_adjustment_logs(budget_category_id,year_month,amount,currency,date,adjustment_type)
      VALUES(1001,'2026-11',100000,'JPY','2026-11-01','allocation'),
            (1002,'2026-11',20000,'JPY','2026-11-01','allocation');
    INSERT INTO journal_entries(id,date,description) VALUES
      (9000,'2026-11-01','初期資金'),(9001,'2026-11-02','貸付元本'),
      (9002,'2026-11-02','借入元本'),(9003,'2026-11-03','回収済元本'),
      (9004,'2026-11-03','返済済元本'),(9005,'2026-11-02','短期貸付元本');
    INSERT INTO journal_lines(journal_entry_id,account_id,debit,credit,currency) VALUES
      (9000,1001,200000,0,'JPY'),(9000,1004,0,200000,'JPY'),
      (9001,1010,100000,0,'JPY'),(9001,1001,0,100000,'JPY'),
      (9002,1001,100000,0,'JPY'),(9002,1011,0,100000,'JPY'),
      (9003,1001,1000,0,'JPY'),(9003,1010,0,1000,'JPY'),
      (9004,1011,1000,0,'JPY'),(9004,1001,0,1000,'JPY'),
      (9005,1012,500,0,'JPY'),(9005,1001,0,500,'JPY');
    INSERT INTO budget_funding_allocations(journal_entry_id,budget_category_id,kind,amount,currency,effect) VALUES
      (9001,1001,'lend',100000,'JPY','apply'),(9002,1001,'borrow',100000,'JPY','apply'),
      (9003,1001,'collect',1000,'JPY','apply'),(9004,1001,'repay',1000,'JPY','apply'),
      (9005,1001,'lend',500,'JPY','apply');
    INSERT INTO loan_settlements(journal_entry_id) VALUES(9005);
    INSERT INTO long_term_loan_plans(account_id,total_principal,annual_interest_rate,start_year_month,currency)
      VALUES(1010,100000,12,'2026-11','JPY'),(1011,100000,12,'2026-11','JPY');
    INSERT INTO journal_entries(id,date,description)
      SELECT id+100,date,description||' USD' FROM journal_entries WHERE id BETWEEN 9000 AND 9004;
    INSERT INTO journal_lines(journal_entry_id,account_id,debit,credit,currency)
      SELECT journal_entry_id+100,account_id,debit,credit,'USD' FROM journal_lines WHERE journal_entry_id BETWEEN 9000 AND 9004;
    INSERT INTO budget_funding_allocations(journal_entry_id,budget_category_id,kind,amount,currency,effect)
      SELECT journal_entry_id+100,budget_category_id,kind,amount,'USD',effect
      FROM budget_funding_allocations WHERE journal_entry_id BETWEEN 9001 AND 9004;
    INSERT INTO budget_adjustment_logs(budget_category_id,year_month,amount,currency,date,adjustment_type)
      VALUES(1001,'2026-11',100000,'USD','2026-11-01','allocation');
  `);
  return fixture;
}
