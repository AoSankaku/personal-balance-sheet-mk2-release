import type { StoreAccountMapping } from "@balance-sheet/shared";
import type { ParsedTransaction } from "../utils/csvParser";
import type { CsvRowState, WithdrawalRowType } from "../utils/inputDrafts";
import { normalizeStore } from "../utils/csvInputUtils";

export function applyStoreMappingsToRows(
  transactions: ParsedTransaction[],
  mappings: StoreAccountMapping[],
): CsvRowState[] {
  const mappingMap = new Map(
    mappings.map((mapping) => [normalizeStore(mapping.store_name), mapping]),
  );
  return transactions.map((tx) => {
    const mapping = mappingMap.get(normalizeStore(tx.store));
    return {
      counterAccountId: mapping ? String(mapping.account_id) : null,
      budgetCategoryId:
        tx.direction === "deposit" && mapping?.budget_category_id != null
          ? String(mapping.budget_category_id)
          : null,
      rowType:
        tx.direction === "withdrawal" && tx.store.includes("口座振替")
          ? "liability"
          : "expense",
      skip: false,
      note: tx.store,
    };
  });
}

export function applyStoreMappingToRows(
  transactions: ParsedTransaction[],
  rows: CsvRowState[],
  storeKey: string,
  accountId: string,
  rowType: WithdrawalRowType,
  budgetCategoryId: string | null,
): CsvRowState[] {
  const normalizedKey = normalizeStore(storeKey);
  return rows.map((row, index) => {
    const tx = transactions[index];
    if (!tx || normalizeStore(tx.store) !== normalizedKey) return row;
    return {
      ...row,
      counterAccountId: accountId,
      budgetCategoryId: tx.direction === "deposit" ? budgetCategoryId : null,
      rowType,
      note: tx.store,
    };
  });
}
