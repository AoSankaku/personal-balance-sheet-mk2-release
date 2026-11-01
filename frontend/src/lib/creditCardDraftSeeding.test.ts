import { expect, test } from "bun:test";
import { mergeCreditCardDraftRows } from "./creditCardDraftSeeding";

test("seeds saved and journal-derived statement months", () => {
  const rows = mergeCreditCardDraftRows({
    currentRows: undefined,
    persistedRows: [{ id: 1, account_id: 2, account_name: "Card", payment_month: "2026-09", amount: 100, status: "confirmed", last_updated_at: "2026-09-01" }],
    derivedMonths: new Set(["2026-10", "2026-09"]),
    currentMonth: "2026-10",
  });
  expect(rows.filter((row) => row.payment_month === "2026-09")).toHaveLength(1);
  expect(rows.find((row) => row.payment_month === "2026-09")?.amount).toBe(100);
  expect(rows.find((row) => row.payment_month === "2026-10")?.status).toBe("open");
});

test("adds journal months later without resetting edits or restoring explicitly removed months", () => {
  const savedDraft = {
    id: "seed-2-2026-09", payment_month: "2026-09", amount: "321", status: "confirmed" as const,
  };
  const rows = mergeCreditCardDraftRows({
    currentRows: [savedDraft],
    persistedRows: [],
    derivedMonths: new Set(["2026-09", "2026-08", "2026-07"]),
    currentMonth: "2026-10",
    suppressedMonths: new Set(["2026-07"]),
  });
  expect(rows.find((row) => row.payment_month === "2026-09")).toEqual(savedDraft);
  expect(rows.find((row) => row.payment_month === "2026-08")?.amount).toBe("");
  expect(rows.some((row) => row.payment_month === "2026-07")).toBe(false);
});

test("adds the new open month on rollover without journal changes or losing prior edits", () => {
  const savedDraft = {
    id: "edited-10", payment_month: "2026-10", amount: "654", status: "open" as const,
  };
  const rows = mergeCreditCardDraftRows({
    currentRows: [savedDraft],
    persistedRows: [],
    derivedMonths: new Set(["2026-10"]),
    currentMonth: "2026-11",
    suppressedMonths: new Set(["2026-09"]),
  });
  expect(rows.find((row) => row.payment_month === "2026-11")).toMatchObject({
    status: "open", amount: "",
  });
  expect(rows.find((row) => row.payment_month === "2026-10")).toEqual(savedDraft);
  expect(rows.some((row) => row.payment_month === "2026-09")).toBe(false);
});

test("retains a suppressed month when it already contains a user edit", () => {
  const savedDraft = {
    id: "edited-09", payment_month: "2026-09", amount: "789", status: "confirmed" as const,
  };
  const rows = mergeCreditCardDraftRows({
    currentRows: [savedDraft],
    persistedRows: [],
    derivedMonths: new Set(),
    currentMonth: "2026-10",
    suppressedMonths: new Set(["2026-09"]),
  });
  expect(rows.find((row) => row.payment_month === "2026-09")).toEqual(savedDraft);
});
