import { expect, test } from "bun:test";
import app from "../src/index";
import { createIncomeBudgetScopeFixture } from "./helpers/incomeBudgetScopeFixture";

test("changed tag metadata invalidates stale journal mutations while a no-op does not", async () => {
  const fixture = createIncomeBudgetScopeFixture();
  try {
    const revision = () => fixture.sqlite.query("SELECT revision FROM depreciation_budget_state WHERE id=1").get<{revision:number}>()!.revision;
    const before = revision();
    const update = () => app.request("/api/journal/9000/expense-tags", {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ expense_tags: ["2026年秋旅行"] }),
    }, { DB: fixture.DB });
    expect((await update()).status).toBe(200);
    expect(revision()).toBeGreaterThan(before);
    const after = revision();
    expect((await update()).status).toBe(200);
    expect(revision()).toBe(after);
  } finally { fixture.close(); }
});
