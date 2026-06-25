import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import type { Env } from "./db";
import { accountsRouter } from "./routes/accounts";
import { journalRouter } from "./routes/journal";
import { reportsRouter } from "./routes/reports";
import { cryptoRouter } from "./routes/crypto";
import { exchangeCredentialsRouter } from "./routes/exchangeCredentials";
import { budgetRouter } from "./routes/budget";
import { creditCardSettingsRouter } from "./routes/creditCardSettings";
import { storeMappingsRouter } from "./routes/storeMappings";
import { adminRouter } from "./routes/admin";
import { depreciationRouter } from "./routes/depreciation";
import { trialBalanceRouter } from "./routes/trialBalance";
import { loansRouter } from "./routes/loans";
import { currenciesRouter } from "./routes/currencies";
import { longTermLoanPlansRouter } from "./routes/longTermLoanPlans";
import {
  databaseNotInitializedResponse,
  isMissingD1TableError,
} from "./lib/d1Errors";

const app = new Hono<{ Bindings: Env }>();

app.onError((error, c) => {
  if (isMissingD1TableError(error)) {
    return c.json(databaseNotInitializedResponse(), 503);
  }

  console.error(error);
  return c.json({ error: "internal_server_error" }, 500);
});

function isAdminApiDisabled(value: string | undefined): boolean {
  return ["1", "true", "yes", "on"].includes(
    (value ?? "").trim().toLowerCase(),
  );
}

app.use("*", logger());
app.use(
  "/api/*",
  cors({
    origin: ["http://localhost:5173", "http://localhost:4173"],
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type"],
  }),
);

app.use("/api/admin/*", async (c, next) => {
  if (isAdminApiDisabled(c.env.DISABLE_ADMIN_API)) {
    return c.json({ error: "admin_api_disabled" }, 403);
  }
  await next();
});

app.route("/api/accounts", accountsRouter);
app.route("/api/journal", journalRouter);
app.route("/api/reports", reportsRouter);
app.route("/api/crypto", cryptoRouter);
app.route("/api/exchange-credentials", exchangeCredentialsRouter);
app.route("/api/budget", budgetRouter);
app.route("/api/credit-card-settings", creditCardSettingsRouter);
app.route("/api/store-mappings", storeMappingsRouter);
app.route("/api/admin", adminRouter);
app.route("/api/depreciation", depreciationRouter);
app.route("/api/trial-balance", trialBalanceRouter);
app.route("/api/loans", loansRouter);
app.route("/api/currencies", currenciesRouter);
app.route("/api/long-term-loan-plans", longTermLoanPlansRouter);

app.get("/api/health", (c) =>
  c.json({ status: "ok", service: "balance-sheet-worker" }),
);

export default app;
