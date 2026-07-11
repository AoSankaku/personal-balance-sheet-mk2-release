import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

import { resolveMonthlyPayday } from "@balance-sheet/shared";

const frontendRoot = join(import.meta.dir, "..");

describe("salary payday end-of-month handling", () => {
  test("resolves zero as the end of the current month", () => {
    expect(resolveMonthlyPayday("2026-02", 0)).toBe(28);
    expect(resolveMonthlyPayday("2028-02", 0)).toBe(29);
    expect(resolveMonthlyPayday("2026-04", 31)).toBe(30);
    expect(resolveMonthlyPayday("2026-04", 25)).toBe(25);
  });

  test("salary payday input offers the same end-of-month option as credit card closing day", () => {
    const source = readFileSync(
      join(frontendRoot, "src/components/AddAccountModal.tsx"),
      "utf8",
    );

    expect(source).toContain("PAYDAY_OPTIONS");
    expect(source).toMatch(
      /selectedType === "income"[\s\S]*?data=\{\[\s*\{ value: "0", label: t\("closingDayEndOfMonth"\) \},\s*\.\.\.PAYDAY_OPTIONS/,
    );
  });
});
