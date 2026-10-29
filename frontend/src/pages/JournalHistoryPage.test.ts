import { expect, test } from "bun:test";
import { formatJournalHistoryAmount } from "./JournalHistoryPage";

test("journal history amounts preserve the smallest supported crypto currency unit", () => {
  expect(formatJournalHistoryAmount(0.000000001, "en")).toBe("0.000000001");
  expect(formatJournalHistoryAmount(-0.000000001, "en")).toBe("-0.000000001");
});
