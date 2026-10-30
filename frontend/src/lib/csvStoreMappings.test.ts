import { describe, expect, test } from "bun:test";
import type { StoreAccountMapping } from "@balance-sheet/shared";
import type { CsvRowState } from "../utils/inputDrafts";
import type { ParsedTransaction } from "../utils/csvParser";
import { applyStoreMappingsToRows, applyStoreMappingToRows } from "./csvStoreMappings";

const transactions: ParsedTransaction[] = [
  { date: "2026-09-20", store: "利息", amount: 173, paymentMonth: "", direction: "deposit", rawRow: "" },
  { date: "2026-10-20", store: " 利息 ", amount: 180, paymentMonth: "", direction: "deposit", rawRow: "" },
  { date: "2026-10-20", store: "Other store", amount: 100, paymentMonth: "", direction: "deposit", rawRow: "" },
  { date: "2026-10-20", store: "利息", amount: 100, paymentMonth: "", direction: "withdrawal", rawRow: "" },
  { date: "2026-10-20", store: "口座振替", amount: 100, paymentMonth: "", direction: "withdrawal", rawRow: "" },
];

const mapping = {
  id: 1, store_name: "利息", account_id: 1001, account_name: "Temporary income",
  budget_category_id: 2001, created_at: "2026-10-01",
} satisfies StoreAccountMapping;

describe("CSV store mapping application", () => {
  test("restores both income account and budget category on a later import", () => {
    const rows = applyStoreMappingsToRows(transactions, [mapping]);
    expect(rows[0]).toMatchObject({ counterAccountId: "1001", budgetCategoryId: "2001" });
    expect(rows[1]).toMatchObject({ counterAccountId: "1001", budgetCategoryId: "2001" });
    expect(rows[2]).toMatchObject({ counterAccountId: null, budgetCategoryId: null });
    expect(rows[3]?.budgetCategoryId).toBeNull();
    expect(rows[4]?.rowType).toBe("liability");
  });

  test("applies and clears the budget category for matching deposits immediately", () => {
    const rows = applyStoreMappingsToRows(transactions, []);
    rows[1] = { ...rows[1]!, skip: true };
    const applied = applyStoreMappingToRows(transactions, rows, "利息", "1001", "expense", "2001");
    expect(applied[0]?.budgetCategoryId).toBe("2001");
    expect(applied[1]).toMatchObject({ counterAccountId: "1001", budgetCategoryId: "2001", skip: true });
    expect(applied[2]).toBe(rows[2]);
    expect(applied[3]?.budgetCategoryId).toBeNull();
    expect(rows[0]?.counterAccountId).toBeNull();

    const cleared = applyStoreMappingToRows(transactions, applied, "利息", "1001", "expense", null);
    expect(cleared[0]?.budgetCategoryId).toBeNull();
    expect(cleared[1]?.budgetCategoryId).toBeNull();
  });

  test("restores legacy account-only mappings without allocating a budget", () => {
    const { budget_category_id: _omitted, ...legacy } = mapping;
    const rows = applyStoreMappingsToRows(transactions, [legacy as StoreAccountMapping]);
    expect(rows[0]).toMatchObject({ counterAccountId: "1001", budgetCategoryId: null });
  });

  test("leaves an unmatched draft row unchanged", () => {
    const extra: CsvRowState = { counterAccountId: null, budgetCategoryId: null, rowType: "expense", skip: false, note: "Extra" };
    const rows = [...applyStoreMappingsToRows(transactions, []), extra];
    expect(applyStoreMappingToRows(transactions, rows, "利息", "1001", "expense", "2001").at(-1)).toBe(extra);
  });
});
