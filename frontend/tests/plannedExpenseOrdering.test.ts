import { describe, expect, test } from "bun:test";

import {
  moveById,
  moveByStep,
  withSequentialSortOrder,
} from "../src/lib/plannedExpenseOrdering";

describe("planned expense manual ordering", () => {
  test("moves an entry before the drop target and reassigns dense sort order", () => {
    const entries = [
      { id: 1, sort_order: 0, name: "Camera" },
      { id: 2, sort_order: 1, name: "Lens" },
      { id: 3, sort_order: 2, name: "Bag" },
    ];

    const moved = withSequentialSortOrder(moveById(entries, 3, 1, "before"));

    expect(moved.map((entry) => entry.id)).toEqual([3, 1, 2]);
    expect(moved.map((entry) => entry.sort_order)).toEqual([0, 1, 2]);
  });

  test("moves an entry after the drop target", () => {
    const entries = [
      { id: 1, sort_order: 0 },
      { id: 2, sort_order: 1 },
      { id: 3, sort_order: 2 },
    ];

    expect(moveById(entries, 1, 3, "after").map((entry) => entry.id)).toEqual([
      2,
      3,
      1,
    ]);
  });

  test("keeps order unchanged for invalid drag targets", () => {
    const entries = [
      { id: 1, sort_order: 0 },
      { id: 2, sort_order: 1 },
    ];

    expect(moveById(entries, 1, 99, "before")).toEqual(entries);
    expect(moveById(entries, 1, 1, "after")).toEqual(entries);
  });

  test("moves an entry one step up or down for touch-friendly controls", () => {
    const entries = [
      { id: 1, sort_order: 0 },
      { id: 2, sort_order: 1 },
      { id: 3, sort_order: 2 },
    ];

    expect(moveByStep(entries, 2, "up").map((entry) => entry.id)).toEqual([
      2,
      1,
      3,
    ]);
    expect(moveByStep(entries, 2, "down").map((entry) => entry.id)).toEqual([
      1,
      3,
      2,
    ]);
  });

  test("keeps order unchanged when step movement cannot be applied", () => {
    const entries = [
      { id: 1, sort_order: 0 },
      { id: 2, sort_order: 1 },
    ];

    expect(moveByStep(entries, 1, "up")).toEqual(entries);
    expect(moveByStep(entries, 2, "down")).toEqual(entries);
    expect(moveByStep(entries, 99, "up")).toEqual(entries);
  });
});
