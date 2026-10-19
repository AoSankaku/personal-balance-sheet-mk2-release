import app from "../../src/index";
import { createIncomeBudgetScopeFixture } from "./incomeBudgetScopeFixture";

const fixture = createIncomeBudgetScopeFixture();
const port = Number(process.env.INCOME_SCOPE_QA_PORT ?? 18787);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid QA port");
const server = Bun.serve({
  hostname: "127.0.0.1", port,
  fetch: (request) => new URL(request.url).pathname === "/__income-scope-qa"
    ? Response.json({ isolated: true })
    : app.fetch(request, { DB: fixture.DB, DISABLE_ADMIN_API: "1" }),
});
console.log(`Isolated income-scope QA API: ${server.url}`);
