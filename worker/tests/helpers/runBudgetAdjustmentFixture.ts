import { Hono } from "hono";
import { budgetRouter } from "../../src/routes/budget";
import { accountsRouter } from "../../src/routes/accounts";
import { createIncomeBudgetScopeFixture } from "./incomeBudgetScopeFixture";

// Disposable, synthetic browser-test data. Never connects to Wrangler or D1 remote.
function createFixture() {
const fixture = createIncomeBudgetScopeFixture();
fixture.sqlite.exec(`
  UPDATE budget_categories SET name='予算A' WHERE id=1001;
  UPDATE budget_adjustment_logs SET amount=20000 WHERE budget_category_id=1001;
  INSERT INTO budget_categories(id,name,is_archived) VALUES (1002,'予算B',0),(1003,'予算C',0),(1004,'アーカイブ予算',1);
  INSERT INTO budget_adjustment_logs(budget_category_id,year_month,amount,currency,date,adjustment_type)
    VALUES (1002,'2026-10',15000,'JPY','2026-10-01','allocation'),(1003,'2026-10',5000,'JPY','2026-10-01','allocation');
  INSERT INTO enabled_currencies(code,decimal_places) VALUES ('USD',2);
  INSERT INTO budget_adjustment_logs(budget_category_id,year_month,amount,currency,date,adjustment_type)
    VALUES (1001,'2026-10',1234,'USD','2026-10-01','allocation'),(1002,'2026-10',-2000,'USD','2026-10-01','allocation');
`);
return fixture;
}
let fixture = createFixture();
const app = new Hono();
let previews = 0, batches = 0;
app.use("*", async (c, next) => {
  c.env = { DB: fixture.DB };
  if (c.req.path.endsWith("/allocations/preview")) previews++;
  if (c.req.path.endsWith("/allocations/batch")) batches++;
  await next();
});
app.route("/api/budget", budgetRouter);
app.route("/api/accounts", accountsRouter);
app.get("/__state", c => c.json({ isolated: true, previews, batches, logs: fixture.sqlite.query("SELECT id,budget_category_id,amount,currency,note FROM budget_adjustment_logs ORDER BY id").all() }));
app.post("/__reset", c => { fixture.close(); fixture = createFixture(); previews = 0; batches = 0; return c.json({ isolated: true }); });
app.post("/__bump", c => {
  fixture.sqlite.exec("INSERT INTO budget_adjustment_logs(budget_category_id,year_month,amount,currency,date,adjustment_type) VALUES(1003,'2026-11',1,'JPY','2026-11-09','allocation')");
  return c.json({ isolated: true });
});
const server = Bun.serve({ hostname: "127.0.0.1", port: Number(process.argv[2] || 18794), fetch: app.fetch });
console.log(`Synthetic budget adjustment fixture: ${server.url}`);
function close() { server.stop(true); fixture.close(); process.exit(0); }
process.on("SIGINT", close);
process.on("SIGTERM", close);
