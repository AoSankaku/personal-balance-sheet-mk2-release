import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BudgetPageState } from "./BudgetPage";

describe("BudgetPageState", () => {
  const budgetCheck = createElement("section", null, "budget check loaded");

  test("keeps the budget check unmounted while app data is loading", () => {
    const html = renderToStaticMarkup(
      createElement(
        BudgetPageState,
        {
          loading: true,
          error: null,
          errorFallback: createElement("div", { role: "alert" }, "failed"),
        },
        budgetCheck,
      ),
    );

    expect(html).not.toContain("budget check loaded");
    expect(html).not.toContain('role="alert"');
  });

  test("shows the error fallback without mounting the budget check", () => {
    const html = renderToStaticMarkup(
      createElement(
        BudgetPageState,
        {
          loading: false,
          error: "network unavailable",
          errorFallback: createElement(
            "div",
            { role: "alert" },
            "network unavailable",
          ),
        },
        budgetCheck,
      ),
    );

    expect(html).toContain('role="alert"');
    expect(html).toContain("network unavailable");
    expect(html).not.toContain("budget check loaded");
  });

  test("mounts the budget check after app data loads successfully", () => {
    const html = renderToStaticMarkup(
      createElement(
        BudgetPageState,
        {
          loading: false,
          error: null,
          errorFallback: createElement("div", { role: "alert" }, "failed"),
        },
        budgetCheck,
      ),
    );

    expect(html).toContain("budget check loaded");
  });
});
