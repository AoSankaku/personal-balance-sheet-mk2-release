import { describe, expect, test } from "bun:test";

import { computeCreditCardWithdrawalRiskNotifications } from "../src/lib/creditCardWithdrawalRisk";
import type {
  Account,
  CreditCardSettings,
  CreditCardStateEntry,
} from "@balance-sheet/shared";

const accounts: Account[] = [
  {
    id: 1,
    name: "Main Bank",
    type: "asset",
    category: "cash",
    created_at: "2026-05-01T00:00:00.000Z",
    balance: 50_000,
  },
  {
    id: 2,
    name: "Card A",
    type: "liability",
    category: "credit_card",
    created_at: "2026-05-01T00:00:00.000Z",
  },
  {
    id: 3,
    name: "Card B",
    type: "liability",
    category: "credit_card",
    created_at: "2026-05-01T00:00:00.000Z",
  },
];

const baseSettings: CreditCardSettings[] = [
  {
    id: 1,
    account_id: 2,
    closing_day: 10,
    confirmation_day: 15,
    withdrawal_day: 26,
    billing_offset_months: 0,
    withdrawal_account_id: 1,
    created_at: "2026-05-01T00:00:00.000Z",
  },
  {
    id: 2,
    account_id: 3,
    closing_day: 10,
    confirmation_day: 15,
    withdrawal_day: 26,
    billing_offset_months: 0,
    withdrawal_account_id: 1,
    created_at: "2026-05-01T00:00:00.000Z",
  },
];

describe("computeCreditCardWithdrawalRiskNotifications", () => {
  test("warns when one linked card would make its withdrawal account negative within fourteen days", () => {
    const notifications = computeCreditCardWithdrawalRiskNotifications({
      today: new Date("2026-05-12T00:00:00"),
      accounts,
      creditCardSettings: [baseSettings[0]!],
      creditCardState: [
        {
          id: 1,
          account_id: 2,
          account_name: "Card A",
          payment_month: "2026-05",
          status: "confirmed",
          amount: 60_000,
          last_updated_at: "2026-05-01T00:00:00.000Z",
        },
      ],
    });

    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({
      creditCardAccountId: 2,
      withdrawalAccountId: 1,
      amount: 60_000,
      projectedBalance: -10_000,
      combinedProjectedBalance: -10_000,
    });
  });

  test("warns when multiple linked cards together would make the withdrawal account negative", () => {
    const notifications = computeCreditCardWithdrawalRiskNotifications({
      today: new Date("2026-05-20T00:00:00"),
      accounts,
      creditCardSettings: baseSettings,
      creditCardState: [
        {
          id: 1,
          account_id: 2,
          account_name: "Card A",
          payment_month: "2026-05",
          status: "confirmed",
          amount: 30_000,
          last_updated_at: "2026-05-01T00:00:00.000Z",
        },
        {
          id: 2,
          account_id: 3,
          account_name: "Card B",
          payment_month: "2026-05",
          status: "confirmed",
          amount: 30_000,
          last_updated_at: "2026-05-01T00:00:00.000Z",
        },
      ],
    });

    expect(notifications.map((n) => n.creditCardName)).toEqual([
      "Card A",
      "Card B",
    ]);
    expect(notifications[0]?.projectedBalance).toBe(20_000);
    expect(notifications[0]?.combinedProjectedBalance).toBe(-10_000);
  });

  test("does not warn before the fourteen day window", () => {
    const notifications = computeCreditCardWithdrawalRiskNotifications({
      today: new Date("2026-05-11T00:00:00"),
      accounts,
      creditCardSettings: [baseSettings[0]!],
      creditCardState: [
        {
          id: 1,
          account_id: 2,
          account_name: "Card A",
          payment_month: "2026-05",
          status: "confirmed",
          amount: 60_000,
          last_updated_at: "2026-05-01T00:00:00.000Z",
        },
      ],
    });

    expect(notifications).toEqual([]);
  });

  test("does not warn after the state is paid", () => {
    const notifications = computeCreditCardWithdrawalRiskNotifications({
      today: new Date("2026-05-12T00:00:00"),
      accounts,
      creditCardSettings: [baseSettings[0]!],
      creditCardState: [
        {
          id: 1,
          account_id: 2,
          account_name: "Card A",
          payment_month: "2026-05",
          status: "paid",
          amount: 60_000,
          last_updated_at: "2026-05-01T00:00:00.000Z",
        },
      ],
    });

    expect(notifications).toEqual([]);
  });
});
