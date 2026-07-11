export const WISHLIST_CLOSED_RETENTION_LIMIT = 10;

type WishlistClosedRetentionRow = {
  id: number;
  status: string;
  updated_at: string;
};

type CurrencyWishlistClosedRetentionRow = WishlistClosedRetentionRow & {
  currency: string;
};

export function isWishlistClosedStatus(status: string): boolean {
  return status === "completed" || status === "cancelled";
}

export function selectWishlistClosedItemIdsToDelete(
  rows: WishlistClosedRetentionRow[],
  limit = WISHLIST_CLOSED_RETENTION_LIMIT,
): number[] {
  return rows
    .filter((row) => isWishlistClosedStatus(row.status))
    .sort(
      (a, b) =>
        b.updated_at.localeCompare(a.updated_at) ||
        b.id - a.id,
    )
    .slice(limit)
    .map((row) => row.id);
}

export function selectWishlistClosedItemIdsToDeleteByCurrency(
  rows: CurrencyWishlistClosedRetentionRow[],
  limit = WISHLIST_CLOSED_RETENTION_LIMIT,
): number[] {
  const rowsByCurrency = new Map<string, CurrencyWishlistClosedRetentionRow[]>();
  for (const row of rows) {
    const currency = (row.currency || "JPY").toUpperCase();
    const currencyRows = rowsByCurrency.get(currency) ?? [];
    currencyRows.push(row);
    rowsByCurrency.set(currency, currencyRows);
  }
  return [...rowsByCurrency.values()].flatMap((currencyRows) =>
    selectWishlistClosedItemIdsToDelete(currencyRows, limit),
  );
}
