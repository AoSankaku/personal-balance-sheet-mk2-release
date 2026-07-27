import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const source = (path: string) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("credit card manual statement completion flow", () => {
  test("keeps a pending statement completion when CSV Amazon rows move to bulk input", () => {
    const drafts = source("src/utils/inputDrafts.ts");
    const csvImport = source("src/components/CsvImportTab.tsx");

    expect(drafts).toContain("statementCompletion");
    expect(csvImport).toContain("statementCompletion: manualCompletion");
    expect(csvImport).toContain("!selectedManualCompletion");
    expect(csvImport).toContain(
      "setPendingManualCompletion(selectedManualCompletion)",
    );
  });

  test("lets bulk input complete the statement without adding journal rows", () => {
    const bulkInput = source("src/components/BulkExpenseTab.tsx");

    expect(bulkInput).toContain("api.creditCardStatements.complete");
    expect(bulkInput).toContain('t("creditCardStatementMarkComplete")');
  });

  test("accepts manual confirmation as a completion method in the API", () => {
    const sharedTypes = source("../shared/types.ts");
    const route = source("../worker/src/routes/creditCardStatements.ts");
    const schema = source("../worker/src/db/schema.ts");

    expect(sharedTypes).toContain('"manual_confirmation"');
    expect(route).toContain('"manual_confirmation"');
    expect(schema).toContain('"manual_confirmation"');
  });

  test("writes a confirmed CSV total to trial-balance credit-card state", () => {
    const csvImport = source("src/components/CsvImportTab.tsx");
    const apiClient = source("src/api/client.ts");

    expect(csvImport).toContain("getConfirmedCsvCreditCardState");
    expect(csvImport).toContain(
      "api.trialBalance.upsertCreditCardState(confirmedCsvState)",
    );
    expect(csvImport).toContain("refreshCreditCardState");
    expect(apiClient).toContain("upsertCreditCardState");
  });

  test("hides the zero-amount statement form after a CSV is selected", () => {
    const csvImport = source("src/components/CsvImportTab.tsx");

    expect(csvImport).toContain(
      "{!parseResult && creditCardAccounts.length > 0 && (",
    );
  });
});
