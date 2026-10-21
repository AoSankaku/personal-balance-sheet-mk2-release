import { createTestD1 } from "./d1";

/** Disposable data shared by API and headless UI verification. */
export function createIncomeBudgetScopeFixture() {
  const fixture = createTestD1();
  fixture.sqlite.exec(`
    INSERT INTO enabled_currencies(code, decimal_places) VALUES ('JPY', 0);
    INSERT INTO accounts(id,name,type,category,include_in_allocatable,deduct_from_budget) VALUES
      (1001,'テスト銀行','asset','cash',1,0),
      (1002,'非追跡テスト','asset','cash',0,0),
      (1003,'対象外カード','liability','credit_card',1,0),
      (1004,'対象カード','liability','credit_card',1,1),
      (1005,'値引き収入','income','other',1,0),
      (1006,'テスト費用','expense','other',1,0),
      (1007,'別の銀行','asset','cash',1,0),
      (1008,'初期残高','equity','opening_balance',1,0);
    INSERT INTO budget_categories(id,name) VALUES (1001,'生活費');
    INSERT INTO budget_category_accounts(budget_category_id,account_id,ratio) VALUES (1001,1006,100);
    INSERT INTO budget_category_account_targets(budget_category_id,account_id,ratio) VALUES (1001,1007,100);
    INSERT INTO journal_entries(id,date,description) VALUES (9000,'2026-10-01','テスト初期残高');
    INSERT INTO journal_lines(journal_entry_id,account_id,debit,credit,currency) VALUES
      (9000,1001,100000,0,'JPY'),(9000,1004,0,5000,'JPY'),(9000,1008,0,95000,'JPY');
    INSERT INTO budget_adjustment_logs(budget_category_id,year_month,amount,currency,date,adjustment_type)
      VALUES(1001,'2026-10',10000,'JPY','2026-10-01','allocation');
  `);
  return fixture;
}
