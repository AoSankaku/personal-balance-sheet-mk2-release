import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  isPlannedExpenseCategoryCurrencyCompatible,
} from "../src/lib/plannedExpenseCurrency";

const workerDir = join(import.meta.dir, "..");

describe("planned expense currency scope", () => {
  test("requires category kind and currency to match the item", () => {
    const category = { kind: "wishlist", currency: "JPY" };

    expect(
      isPlannedExpenseCategoryCurrencyCompatible(category, "wishlist", "JPY"),
    ).toBe(true);
    expect(
      isPlannedExpenseCategoryCurrencyCompatible(category, "wishlist", "USD"),
    ).toBe(false);
    expect(
      isPlannedExpenseCategoryCurrencyCompatible(
        category,
        "scheduled_payment",
        "JPY",
      ),
    ).toBe(false);
  });

  test("filters planned expense and category queries by currency", () => {
    const source = readFileSync(
      join(workerDir, "src/routes/plannedExpenses.ts"),
      "utf8",
    );

    expect(source).toContain("eq(plannedExpenses.currency, requestedCurrency)");
    expect(source).toContain(
      "eq(plannedExpenseCategories.currency, requestedCurrency)",
    );
  });
});
