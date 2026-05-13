import { describe, expect, test } from "bun:test";

import {
  accountDisplayName,
  isUserSelectableAccount,
  toAccountSelectOption,
} from "../src/lib/accountUtils";
import {
  buildGroupedAssetOptions,
  buildGroupedExpenseOptions,
  buildGroupedIncomeOptions,
  buildGroupedLiabilityOptions,
} from "../src/utils/csvInputUtils";

describe("account select option helpers", () => {
  test("excludes system accounts from user-selectable account options", () => {
    expect(isUserSelectableAccount({ is_system: true })).toBe(false);
    expect(isUserSelectableAccount({ is_system: false })).toBe(true);
    expect(isUserSelectableAccount({})).toBe(true);
  });

  test("never exposes raw system account names when a system account must be displayed", () => {
    const t = (key: string) => `translated:${key}`;

    expect(
      accountDisplayName(
        { name: "__system:opening_balance__", is_system: true },
        t,
      ),
    ).toBe("translated:sysOpeningBalance");
    expect(
      toAccountSelectOption(
        { id: 1, name: "__system:misc_expense__", is_system: true },
        t,
      ),
    ).toEqual({ value: "1", label: "translated:sysMiscExpense" });
  });

  test("shared CSV account option builders omit system accounts", () => {
    const accounts = [
      {
        id: 1,
        name: "Cash",
        type: "asset",
        category: "cash",
        created_at: "",
      },
      {
        id: 2,
        name: "__system:unknown_funds__",
        type: "asset",
        category: "other",
        is_system: true,
        created_at: "",
      },
      {
        id: 3,
        name: "__system:misc_expense__",
        type: "expense",
        category: "other",
        is_system: true,
        created_at: "",
      },
      {
        id: 4,
        name: "__system:misc_income__",
        type: "income",
        category: "other",
        is_system: true,
        created_at: "",
      },
      {
        id: 5,
        name: "Card",
        type: "liability",
        category: "credit_card",
        created_at: "",
      },
    ] as const;

    const optionLabels = [
      ...buildGroupedAssetOptions(accounts as never, "Assets").flatMap(
        (group) => group.items.map((item) => item.label),
      ),
      ...buildGroupedExpenseOptions(
        accounts as never,
        "Expenses",
        "Lending",
      ).flatMap((group) => group.items.map((item) => item.label)),
      ...buildGroupedIncomeOptions(accounts as never, "Income").flatMap(
        (group) => group.items.map((item) => item.label),
      ),
      ...buildGroupedLiabilityOptions(accounts as never, "Liabilities").flatMap(
        (group) => group.items.map((item) => item.label),
      ),
    ];

    expect(optionLabels).toEqual(["Cash", "Card"]);
  });
});
