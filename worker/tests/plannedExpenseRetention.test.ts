import { describe, expect, test } from "bun:test";

import {
  selectWishlistClosedItemIdsToDelete,
  selectWishlistClosedItemIdsToDeleteByCurrency,
  WISHLIST_CLOSED_RETENTION_LIMIT,
} from "../src/lib/plannedExpenseRetention";

describe("wishlist closed item retention", () => {
  test("keeps only the latest ten completed or cancelled wishlist items", () => {
    const rows = Array.from({ length: 12 }, (_, index) => ({
      id: index + 1,
      status: index % 2 === 0 ? "completed" : "cancelled",
      updated_at: `2026-07-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
    }));

    expect(selectWishlistClosedItemIdsToDelete(rows)).toEqual([2, 1]);
    expect(WISHLIST_CLOSED_RETENTION_LIMIT).toBe(10);
  });

  test("does not count open items toward the retention limit", () => {
    const rows = [
      { id: 99, status: "open", updated_at: "2026-07-99T00:00:00.000Z" },
      ...Array.from({ length: 10 }, (_, index) => ({
        id: index + 1,
        status: "completed",
        updated_at: `2026-07-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
      })),
    ];

    expect(selectWishlistClosedItemIdsToDelete(rows)).toEqual([]);
  });

  test("uses the larger id as newer when closed dates tie", () => {
    const rows = Array.from({ length: 11 }, (_, index) => ({
      id: index + 1,
      status: "completed",
      updated_at: "2026-07-01T00:00:00.000Z",
    }));

    expect(selectWishlistClosedItemIdsToDelete(rows)).toEqual([1]);
  });

  test("retains the latest ten closed items independently per currency", () => {
    const rows = [
      ...Array.from({ length: 11 }, (_, index) => ({
        id: index + 1,
        status: "completed",
        currency: "JPY",
        updated_at: `2026-07-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
      })),
      ...Array.from({ length: 10 }, (_, index) => ({
        id: index + 101,
        status: "completed",
        currency: "USD",
        updated_at: `2026-07-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
      })),
    ];

    expect(selectWishlistClosedItemIdsToDeleteByCurrency(rows)).toEqual([1]);
  });
});
