import app from "../../src/index";
import { createLoanManagementBudgetFixture } from "./loanManagementBudgetFixture";

let fixture = createLoanManagementBudgetFixture();
const port = Number(process.env.LOAN_BUDGET_QA_PORT ?? 18787);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid QA port");
const server = Bun.serve({
  hostname: "127.0.0.1", port,
  fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/__loan-budget-qa") return Response.json({ isolated: true });
    if (path === "/__loan-budget-reset" && request.method === "POST") {
      fixture.close();
      fixture = createLoanManagementBudgetFixture();
      return Response.json({ isolated: true });
    }
    return app.fetch(request, { DB: fixture.DB, DISABLE_ADMIN_API: "1" });
  },
});
console.log(`Isolated loan budget QA API: ${server.url}`);
