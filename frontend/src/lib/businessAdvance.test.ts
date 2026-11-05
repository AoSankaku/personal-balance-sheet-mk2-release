import { describe, expect, test } from "bun:test";
import type { Account } from "@balance-sheet/shared";
import {
  buildBusinessAdvanceJournalPayload,
  requiresExpenseAccountForSimpleEntry,
  splitBusinessExpenseAmount,
} from "./businessAdvance";

const accounts = [
  { id: 1, name: "Main account", type: "asset", category: "cash", include_in_allocatable: true },
  { id: 2, name: "Untracked cash", type: "asset", category: "cash", include_in_allocatable: false },
  { id: 3, name: "Advance", type: "asset", category: "business_advance", include_in_allocatable: false },
  { id: 4, name: "Loss", type: "expense", category: "other", budget_ratios: [{ budget_category_id: 10, ratio: 100 }] },
].map(account => ({ ...account, created_at: "2026-11-05" })) as Account[];

const base = {
  date: "2026-11-05",
  description: "Business funds",
  amount: 125.75,
  currency: "USD",
  advanceAccount: accounts[2]!,
};

describe("business advance entries", () => {
  test("requires a personal expense account only when the purchase has a non-depreciated personal part", () => {
    expect(requiresExpenseAccountForSimpleEntry("business_advance", 100, false)).toBe(false);
    expect(requiresExpenseAccountForSimpleEntry("business_advance", 75, false)).toBe(true);
    expect(requiresExpenseAccountForSimpleEntry("business_advance", 75, true)).toBe(false);
    expect(requiresExpenseAccountForSimpleEntry("expense", 100, false)).toBe(true);
  });

  test("splits business and personal purchase portions in the currency's minor units", () => {
    expect(splitBusinessExpenseAmount(99.99, 50, 2)).toEqual({
      businessAmount: 50,
      personalAmount: 49.99,
    });
    expect(splitBusinessExpenseAmount(199, 33, 0)).toEqual({
      businessAmount: 66,
      personalAmount: 133,
    });
  });

  test("preserves a fully business expense amount exactly", () => {
    expect(splitBusinessExpenseAmount(99.99, 100, 2)).toEqual({
      businessAmount: 99.99,
      personalAmount: 0,
    });
  });

  test("deducts a selected budget once when sending tracked funds to the business", () => {
    expect(buildBusinessAdvanceJournalPayload({
      ...base,
      kind: "send",
      otherAccount: accounts[0]!,
      budgetCategoryId: 10,
    })).toEqual({
      date: "2026-11-05",
      description: "Business funds",
      budget_source: "simple",
      lines: [
        { account_id: 3, debit: 125.75, credit: 0, currency: "USD" },
        { account_id: 1, debit: 0, credit: 125.75, currency: "USD" },
      ],
      budget_allocations: [
        { budget_category_id: 10, amount: -125.75, currency: "USD", is_reference: false },
      ],
    });
  });

  test("keeps a send from untracked cash as reference history only", () => {
    expect(buildBusinessAdvanceJournalPayload({
      ...base,
      kind: "send",
      otherAccount: accounts[1]!,
      budgetCategoryId: 10,
    }).budget_allocations).toEqual([
      { budget_category_id: 10, amount: -125.75, currency: "USD", is_reference: true },
    ]);
  });

  test("leaves the business portion unallocated when no budget category is chosen", () => {
    expect(buildBusinessAdvanceJournalPayload({
      ...base,
      kind: "send",
      otherAccount: accounts[0]!,
      budgetCategoryId: null,
    }).budget_allocations).toBeUndefined();
  });

  test("returns recovered cash without assigning it to the former budget", () => {
    const result = buildBusinessAdvanceJournalPayload({
      ...base,
      kind: "recover",
      otherAccount: accounts[0]!,
    });
    expect(result.lines).toEqual([
      { account_id: 1, debit: 125.75, credit: 0, currency: "USD" },
      { account_id: 3, debit: 0, credit: 125.75, currency: "USD" },
    ]);
    expect(result.budget_allocations).toBeUndefined();
  });

  test("writes off the advance without consuming the budget a second time", () => {
    const result = buildBusinessAdvanceJournalPayload({
      ...base,
      kind: "dispose",
      otherAccount: accounts[3]!,
    });
    expect(result.lines).toEqual([
      { account_id: 4, debit: 125.75, credit: 0, currency: "USD" },
      { account_id: 3, debit: 0, credit: 125.75, currency: "USD" },
    ]);
    expect(result.budget_allocations).toBeUndefined();
  });
});
