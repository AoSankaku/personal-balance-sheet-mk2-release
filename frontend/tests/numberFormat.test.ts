import { describe, expect, test } from "bun:test";

import { formatCompactCurrency, formatCurrency } from "../src/lib/numberFormat";

describe("formatCurrency", () => {
  test("uses a display symbol for custom currencies unsupported by Intl", () => {
    expect(formatCurrency(1234.5, "ja", "POINT", "P")).toBe("P\u00a01,234.5");
  });

  test("does not fall back to the custom currency code when a symbol exists", () => {
    expect(formatCurrency(1234.5, "en", "POINT", "@")).not.toContain("POINT");
  });

  test("keeps native formatting for supported fiat currencies", () => {
    expect(formatCurrency(1234.5, "en", "USD", "$")).toBe("$1,234.50");
  });

  test("uses narrow symbols for compact currency labels", () => {
    expect(formatCompactCurrency(123456, "ja", "JPY")).toBe("¥123,456");
  });
});
