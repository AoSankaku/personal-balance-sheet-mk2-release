// ─── Module-level draft state (persists across navigation) ───────────────────
//
// These are intentionally mutable module-level variables so that form state
// survives tab switches / unmounts without needing a global store.

import type { SimpleFormDraft } from "../components/SimpleEntryForm";
import type { CsvFormat, ParseResult } from "./csvParser";

// ── Types for multi-line form ─────────────────────────────────────────────────

export interface MultiLineRow {
  account_id: number | null;
  debit: number;
  credit: number;
  creditCardStatementOffsetMonths: number;
}

// ── Types for CSV import ──────────────────────────────────────────────────────

export type WithdrawalRowType = "expense" | "liability" | "transfer";

export interface CsvRowState {
  counterAccountId: string | null;
  budgetCategoryId: string | null;
  rowType: WithdrawalRowType;
  skip: boolean;
  note: string;
}

export interface CsvDraft {
  parseResult: ParseResult | null;
  manualFormat: CsvFormat | null;
  selectedAccountId: string | null;
  rowStates: CsvRowState[];
}

// ── Types for bulk expense tab ────────────────────────────────────────────────

export interface BulkExpenseRow {
  type: "expense";
  date: Date;
  itemName: string;
  qty: number;
  price: number;
  expenseAccountId: string | null;
}

export interface BulkDiscountRow {
  type: "discount";
  date: Date;
  discountType: string;
  amount: number;
  incomeAccountId: string | null;
  budgetCategoryId: string | null;
}

export type BulkRow = BulkExpenseRow | BulkDiscountRow;

export interface BillingRow {
  label: string;
  amount: string;
}

export interface BulkDraft {
  paymentAccountId: string | null;
  rows: BulkRow[];
  billingRows: BillingRow[];
}

// ── Default values ────────────────────────────────────────────────────────────

export const DEFAULT_BILLING_ROW: BillingRow = { label: "", amount: "" };

// ── Mutable draft state ───────────────────────────────────────────────────────

export let savedTab = "simple";
export let simpleDraft: SimpleFormDraft | null = null;
export let multiDraft: {
  date: Date;
  description: string;
  rows: MultiLineRow[];
} | null = null;
export let budgetDraft: {
  categoryId: string | null;
  amount: number | string;
  date: Date;
  note: string;
} | null = null;
export let csvDraft: CsvDraft = {
  parseResult: null,
  manualFormat: null,
  selectedAccountId: null,
  rowStates: [],
};
export let bulkDraft: BulkDraft = {
  paymentAccountId: null,
  rows: [],
  billingRows: [{ ...DEFAULT_BILLING_ROW }],
};

// ── Setters (to allow external mutation of exported lets) ─────────────────────

export function setSavedTab(v: string) {
  savedTab = v;
}
export function setSimpleDraft(v: SimpleFormDraft | null) {
  simpleDraft = v;
}
export function setMultiDraft(
  v: { date: Date; description: string; rows: MultiLineRow[] } | null,
) {
  multiDraft = v;
}
export function setBudgetDraft(
  v: {
    categoryId: string | null;
    amount: number | string;
    date: Date;
    note: string;
  } | null,
) {
  budgetDraft = v;
}
export function setCsvDraft(v: CsvDraft) {
  csvDraft = v;
}
export function setBulkDraft(v: BulkDraft) {
  bulkDraft = v;
}
