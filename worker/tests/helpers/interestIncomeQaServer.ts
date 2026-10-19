import app from "../../src/index";
import { createIncomeBudgetScopeFixture } from "./incomeBudgetScopeFixture";

// Disposable data only. No local or remote D1 binding is used.
const fixture = createIncomeBudgetScopeFixture();
fixture.sqlite.exec(`
  UPDATE accounts SET name='預金利息' WHERE id=1005;
  UPDATE budget_categories SET name='自由出費' WHERE id=1001;
  INSERT INTO budget_categories(id,name) VALUES (1002,'必要出費');
  INSERT INTO accounts(id,name,type,category) VALUES (1009,'その他の収入','income','other');
`);
const port = Number(process.env.INTEREST_QA_PORT ?? 18787);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid QA port");
const server = Bun.serve({
  hostname: "127.0.0.1", port,
  fetch: request => new URL(request.url).pathname === "/__interest-qa"
    ? Response.json({ isolated: true })
    : app.fetch(request, { DB: fixture.DB, DISABLE_ADMIN_API: "1" }),
});
console.log(`Isolated interest QA API: ${server.url}`);
