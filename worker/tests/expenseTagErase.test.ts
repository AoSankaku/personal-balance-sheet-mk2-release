import { expect, test } from "bun:test";
import app from "../src/index";
import { createIncomeBudgetScopeFixture } from "./helpers/incomeBudgetScopeFixture";

test("explicit erase-all also removes saved event tag names", async () => {
  const fixture = createIncomeBudgetScopeFixture();
  try {
    fixture.sqlite.exec("INSERT INTO expense_tags(name) VALUES('2026年秋旅行')");
    const response = await app.request("/api/admin/erase", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scope: "all_data" }),
    }, { DB: fixture.DB });
    expect(response.status).toBe(200);
    expect(fixture.sqlite.query("SELECT COUNT(*) AS total FROM expense_tags").get()).toEqual({ total: 0 });
  } finally { fixture.close(); }
});
