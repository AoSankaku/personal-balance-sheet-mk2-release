import app from "../../src/index";
import { createIncomeBudgetScopeFixture } from "./incomeBudgetScopeFixture";

// Disposable seeded data. This server never connects to a local/remote D1 database.
const fixture = createIncomeBudgetScopeFixture();
fixture.sqlite.exec(`
  INSERT OR IGNORE INTO accounts(id,name,type,category,include_in_allocatable,deduct_from_budget) VALUES
    (1009,'テスト投資資産','asset','investment',0,0),
    (1010,'テスト売却益','income','investment',1,0),
    (1011,'テスト売却損','expense','investment_loss',1,0),
    (1012,'第三テスト銀行','asset','cash',1,0);
  UPDATE accounts SET name='テスト投資資産' WHERE id=1009;
  INSERT INTO budget_categories(id,name) VALUES (1002,'投資テスト予算'),(1003,'第三テスト予算');
  INSERT INTO budget_category_account_targets(budget_category_id,account_id,ratio) VALUES (1002,1001,100),(1003,1012,100);
  INSERT INTO journal_entries(id,date,description) VALUES
    (9010,'2026-10-01','投資の初期残高'),
    (9011,'2026-10-20','既存の複合売却テスト');
  INSERT INTO journal_lines(journal_entry_id,account_id,debit,credit,currency) VALUES
    (9010,1009,500000,0,'JPY'),(9010,1008,0,500000,'JPY'),
    (9011,1001,120000,0,'JPY'),(9011,1009,0,100000,'JPY'),(9011,1010,0,20000,'JPY');
  INSERT INTO journal_entry_budget_allocations(journal_entry_id,budget_category_id,amount,currency,source)
    VALUES (9011,1002,120000,'JPY','multiline'),(9011,1001,-10000,'JPY','multiline');
`);
const port = Number(process.env.INVESTMENT_SALE_QA_PORT ?? 18788);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid QA port");
const server = Bun.serve({
  hostname: "127.0.0.1", port,
  fetch: request => new URL(request.url).pathname === "/__investment-sale-qa"
    ? Response.json({ isolated: true, legacyEntryId: 9011 })
    : app.fetch(request, { DB: fixture.DB, DISABLE_ADMIN_API: "1" }),
});
console.log(`Isolated investment-sale QA API: ${server.url}`);
