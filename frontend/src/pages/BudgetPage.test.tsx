import { describe, expect, test } from "bun:test";
import { MantineProvider } from "@mantine/core";
import { createElement } from "react";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BudgetPageState } from "./BudgetPage";

function renderState(props: {
  loading: boolean;
  error: string | null;
  errorFallback: ReactNode;
}) {
  return renderToStaticMarkup(
    createElement(
      MantineProvider,
      null,
      createElement(BudgetPageState, props, budgetCheck),
    ),
  );
}

const budgetCheck = createElement("section", null, "budget check loaded");

describe("BudgetPageState", () => {
  test("keeps the budget check unmounted while app data is loading", () => {
    const html = renderState({
      loading: true,
      error: null,
      errorFallback: createElement("div", { role: "alert" }, "failed"),
    });

    expect(html).not.toContain("budget check loaded");
    expect(html).not.toContain('role="alert"');
    expect(html).toContain('role="status"');
  });

  test("shows the error fallback without mounting the budget check", () => {
    const html = renderState({
      loading: false,
      error: "network unavailable",
      errorFallback: createElement(
        "div",
        { role: "alert" },
        "network unavailable",
      ),
    });

    expect(html).toContain('role="alert"');
    expect(html).toContain("network unavailable");
    expect(html).not.toContain("budget check loaded");
  });

  test("mounts the budget check after app data loads successfully", () => {
    const html = renderState({
      loading: false,
      error: null,
      errorFallback: createElement("div", { role: "alert" }, "failed"),
    });

    expect(html).toContain("budget check loaded");
  });
});
