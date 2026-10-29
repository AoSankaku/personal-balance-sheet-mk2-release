import { expect, test } from "bun:test";
import type { Account, JournalEntry } from "@balance-sheet/shared";
import { expenseTagOptions, summarizeExpenseTags } from "./expenseTagSummary";

const accounts = [{ id: 1, type: "expense" }, { id: 2, type: "asset" }] as Account[];
const tag = (id: number) => ({ id, name: `event ${id}` });
const entry = (id: number, tags: number[], amount: number, currency = "JPY", override?: number) => ({
  id, expense_tags: tags.map(tag), lines: [{ account_id: 1, debit: amount > 0 ? amount : 0, credit: amount < 0 ? -amount : 0, currency }],
  tag_expense_mode: override === undefined ? "auto" : "manual",
  tag_expense_amounts: override === undefined ? [] : [{ currency, amount: override }],
}) as JournalEntry;
const options = { currency: "JPY", includeAllCurrencies: false, convertCurrency: (amount: number, source: string) => source === "USD" ? amount * 150 : amount };

test("event totals deduplicate multi-tag journals while individual events keep their full amount", () => {
  const summary = summarizeExpenseTags([entry(1, [1, 2], 1000), entry(2, [1], 500), entry(3, [2], -200), entry(4, [], 8000)], accounts, options);
  expect(summary.total).toBe(1300);
  expect(summary.entryCount).toBe(3);
  expect(summary.byTag.map(row => [row.id, row.amount])).toEqual([[1, 1500], [2, 800]]);
});

test("manual amounts change only tag totals and selected tag totals use all matching entries", () => {
  const rows = [entry(1, [1, 2], 1000, "JPY", 200), entry(2, [2], 300), entry(3, [3], 5000)];
  const summary = summarizeExpenseTags(rows, accounts, { ...options, selectedTagIds: [1, 2] });
  expect(summary.total).toBe(500);
  expect(summary.byTag.map(row => row.id)).toEqual([1, 2]);
  expect(rows[0]!.lines[0]!.debit).toBe(1000);
  expect(summarizeExpenseTags(rows, accounts, { ...options, selectedTagIds: [9] }).total).toBe(0);
});

test("currencies stay separate until the explicit combined-currency display mode", () => {
  const rows = [entry(1, [1], 1000), entry(2, [1], 10, "USD", 5)];
  expect(summarizeExpenseTags(rows, accounts, options).total).toBe(1000);
  expect(summarizeExpenseTags(rows, accounts, { ...options, includeAllCurrencies: true }).total).toBe(1750);
});

test("automatic totals follow current expense account classifications and refunds", () => {
  const row = entry(1, [1], -200);
  expect(summarizeExpenseTags([row], accounts, options).total).toBe(-200);
  expect(summarizeExpenseTags([row], [{ id: 1, type: "asset" }] as Account[], options).total).toBe(0);
});

test("tag options are stable, unique and include names without mutating source entries", () => {
  const rows = [entry(1, [2, 1], 100), entry(2, [1], 200)];
  expect(expenseTagOptions(rows)).toEqual([{ value: "1", label: "event 1" }, { value: "2", label: "event 2" }]);
  expect(rows[0]!.expense_tags![0]!.id).toBe(2);
});
