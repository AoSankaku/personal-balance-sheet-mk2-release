import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

const root = join(import.meta.dir, "..");
const source = (path: string) => readFileSync(join(root, path), "utf8");

describe("loan budget funding UI", () => {
  test("shows and restores explicit category funding splits", () => {
    const form = source("src/components/SimpleEntryForm.tsx");
    const section = source("src/components/entry/LoanSection.tsx");
    const modal = source("src/components/JournalModal.tsx");

    expect(form).toContain("loanFundingCategoryAmounts");
    expect(form).toContain("budget_funding");
    expect(section).toContain('t("loanFundingBreakdownTitle")');
    expect(section).toContain('t("loanFundingUnallocated")');
    expect(modal).toContain("budget_funding");
    expect(modal).toContain("loan_settlement_source_journal_entry_ids");
  });

  test("explains automatic reversals and reset boundaries", () => {
    const section = source("src/components/entry/LoanSection.tsx");

    expect(section).toContain('t("loanFundingSettlementAutomatic")');
    expect(section).toContain('t("loanFundingResetBoundaryHint")');
  });

  test("shows and persists multi-line funding consequences separately", () => {
    const form = source("src/components/MultiLineEntryForm.tsx");
    const modal = source("src/components/JournalModal.tsx");

    expect(form).toContain('t("multiLineFundingTitle")');
    expect(form).toContain("budget_funding_components");
    expect(form).toContain("component_only_amount");
    expect(form).toContain('t("fundingDiscarded")');
    expect(form).toContain('t("fundingConvertedToOwn")');
    expect(modal).toContain("budgetFundingComponents");
  });
});
