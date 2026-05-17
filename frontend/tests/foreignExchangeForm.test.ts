import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";

const source = readFileSync(
  new URL("../src/components/ForeignExchangeForm.tsx", import.meta.url),
  "utf8",
);

describe("ForeignExchangeForm", () => {
  test("serializes selected dates using the local calendar day", () => {
    expect(source).toContain("toDateStr(date)");
    expect(source).not.toContain("date.toISOString().slice(0, 10)");
  });

  test("marks cross-currency entries as currency exchange entries", () => {
    expect(source).toContain("is_currency_exchange: true");
  });
});
