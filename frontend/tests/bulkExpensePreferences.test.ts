import { describe, expect, test } from "bun:test";
import { shouldCopyLastDateByDefault } from "../src/utils/bulkExpensePreferences";

describe("shouldCopyLastDateByDefault", () => {
  test("defaults to enabled when no preference is saved", () => {
    expect(shouldCopyLastDateByDefault(null)).toBe(true);
  });

  test("preserves an explicitly disabled saved preference", () => {
    expect(shouldCopyLastDateByDefault("false")).toBe(false);
  });

  test("preserves an explicitly enabled saved preference", () => {
    expect(shouldCopyLastDateByDefault("true")).toBe(true);
  });
});
