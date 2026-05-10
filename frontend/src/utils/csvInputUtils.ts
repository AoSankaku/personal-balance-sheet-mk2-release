// ─── Shared utilities for CSV import and account option building ──────────────

import type { useAppData } from "../context/AppDataContext";
import type { CsvFormat, ParsedTransaction } from "./csvParser";

// ── Types ─────────────────────────────────────────────────────────────────────

export type AccountOption = {
  value: string;
  label: string;
  category?: string;
  is_system?: boolean;
};

export type AccountOptionGroup = { group: string; items: AccountOption[] };

// ── Constants ─────────────────────────────────────────────────────────────────

export const FORMAT_LABELS: Record<CsvFormat, string> = {
  "smbc-bank":
    "三井住友銀行（入出金明細）",
  "smbc-draft": "三井住友カード（仮版）",
  "smbc-confirmed": "三井住友カード（確定版）",
  "rakuten-draft": "楽天カード（仮版）",
  "rakuten-confirmed": "楽天カード（確定版）",
  "sbi-bank": "SBI銀行（入出金明細）",
  unknown: "形式不明",
};

/** Amazon store name patterns — add more entries here as needed */
export const AMAZON_STORE_PATTERNS = [
  "ＡＭＡＺＯＮ．ＣＯ．ＪＰ",
  "AMAZON.CO.JP",
];

// ── Helper functions ──────────────────────────────────────────────────────────

export function normalizeStore(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

export function isAmazonTransaction(store: string): boolean {
  const upper = store.toUpperCase();
  return AMAZON_STORE_PATTERNS.some((p) => upper.includes(p.toUpperCase()));
}

export function hasAmazon(transactions: ParsedTransaction[]): boolean {
  return transactions.some((tx) => isAmazonTransaction(tx.store));
}

export function findDuplicateEntries(
  tx: ParsedTransaction,
  accountId: number,
  journal: ReturnType<typeof useAppData>["journal"],
): ReturnType<typeof useAppData>["journal"] {
  const txMonth = tx.date.slice(0, 7);
  const isDeposit = tx.direction === "deposit";
  const matchesByDate = (entryDate: string) =>
    entryDate === tx.date ||
    entryDate.startsWith(txMonth) ||
    (tx.paymentMonth !== "" && entryDate.startsWith(tx.paymentMonth));

  return journal.filter(
    (entry) =>
      matchesByDate(entry.date) &&
      entry.lines.some(
        (l) =>
          l.account_id === accountId &&
          Math.abs((isDeposit ? l.debit : l.credit) - tx.amount) < 1,
      ),
  );
}

// ── Grouped account option builders ──────────────────────────────────────────

export function buildGroupedExpenseOptions(
  accounts: ReturnType<typeof useAppData>["accounts"],
  groupLabel: string,
  lendingGroupLabel: string,
): AccountOptionGroup[] {
  const expenseItems = accounts
    .filter((a) => a.type === "expense")
    .map((a) => ({ value: String(a.id), label: a.name }));
  const lendingItems = accounts
    .filter((a) => a.type === "asset" && a.category === "lending")
    .map((a) => ({ value: String(a.id), label: a.name }));
  return [
    ...(expenseItems.length > 0
      ? [{ group: groupLabel, items: expenseItems }]
      : []),
    ...(lendingItems.length > 0
      ? [{ group: lendingGroupLabel, items: lendingItems }]
      : []),
  ];
}

export function buildGroupedIncomeOptions(
  accounts: ReturnType<typeof useAppData>["accounts"],
  groupLabel: string,
): AccountOptionGroup[] {
  const items = accounts
    .filter((a) => a.type === "income")
    .map((a) => ({ value: String(a.id), label: a.name }));
  return items.length > 0 ? [{ group: groupLabel, items }] : [];
}

export function buildGroupedLiabilityOptions(
  accounts: ReturnType<typeof useAppData>["accounts"],
  groupLabel: string,
): AccountOptionGroup[] {
  const items = accounts
    .filter((a) => a.type === "liability")
    .map((a) => ({ value: String(a.id), label: a.name }));
  return items.length > 0 ? [{ group: groupLabel, items }] : [];
}

export function buildGroupedAssetOptions(
  accounts: ReturnType<typeof useAppData>["accounts"],
  groupLabel: string,
  excludedAccountId?: string | null,
): AccountOptionGroup[] {
  const items = accounts
    .filter(
      (a) => a.type === "asset" && String(a.id) !== (excludedAccountId ?? ""),
    )
    .map((a) => ({ value: String(a.id), label: a.name }));
  return items.length > 0 ? [{ group: groupLabel, items }] : [];
}

export function mergeUniqueOptionGroups(
  ...groupsList: AccountOptionGroup[][]
): AccountOptionGroup[] {
  const seen = new Set<string>();
  const merged: AccountOptionGroup[] = [];

  for (const groups of groupsList) {
    for (const group of groups) {
      const items = group.items.filter((item) => {
        if (seen.has(item.value)) return false;
        seen.add(item.value);
        return true;
      });
      if (items.length > 0) {
        merged.push({ group: group.group, items });
      }
    }
  }

  return merged;
}
