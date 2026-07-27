import { describe, expect, test } from "bun:test";
import { completedDateRange } from "../src/lib/completedDateRange";

describe("completedDateRange", () => {
  const current: [Date | null, Date | null] = [
    new Date(2026, 6, 1),
    new Date(2026, 6, 31),
  ];

  test("keeps the applied range while only a start date is selected", () => {
    const next: [Date | null, Date | null] = [new Date(2026, 7, 1), null];

    expect(completedDateRange(current, next)).toBe(current);
  });

  test("applies a range after both dates are selected", () => {
    const next: [Date | null, Date | null] = [
      new Date(2026, 7, 1),
      new Date(2026, 7, 15),
    ];

    expect(completedDateRange(current, next)).toBe(next);
  });

  test("applies an empty range when the date filter is cleared", () => {
    const next: [Date | null, Date | null] = [null, null];

    expect(completedDateRange(current, next)).toBe(next);
  });
});
