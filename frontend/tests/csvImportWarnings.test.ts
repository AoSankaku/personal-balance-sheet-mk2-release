import { describe, expect, test } from "bun:test";
import { countMissingCounterAccountWarnings } from "../src/utils/csvImportWarnings";

describe("countMissingCounterAccountWarnings", () => {
  test("does not count possible duplicate rows without a selected counter account", () => {
    const count = countMissingCounterAccountWarnings([
      {
        isAmazon: false,
        isSalaryPending: false,
        hasCounterAccount: false,
        isPossibleDuplicate: true,
      },
      {
        isAmazon: false,
        isSalaryPending: false,
        hasCounterAccount: false,
        isPossibleDuplicate: false,
      },
    ]);

    expect(count).toBe(1);
  });

  test("ignores Amazon and pending salary rows", () => {
    const count = countMissingCounterAccountWarnings([
      {
        isAmazon: true,
        isSalaryPending: false,
        hasCounterAccount: false,
        isPossibleDuplicate: false,
      },
      {
        isAmazon: false,
        isSalaryPending: true,
        hasCounterAccount: false,
        isPossibleDuplicate: false,
      },
    ]);

    expect(count).toBe(0);
  });
});
