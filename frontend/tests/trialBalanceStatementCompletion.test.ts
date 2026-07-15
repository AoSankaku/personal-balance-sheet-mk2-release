import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const source = (path: string) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("trial-balance credit-card statement completion", () => {
  test("offers zero-amount and forced completion actions from actual balance input", () => {
    const actualInput = source("src/components/tt/ActualInputSection.tsx");

    expect(actualInput).toContain('completion_method: "zero_amount"');
    expect(actualInput).toContain('completion_method: "manual_confirmation"');
    expect(actualInput).toContain("api.creditCardStatements.complete");
    expect(actualInput).toContain("getSelectableZeroAmountCompletions");
  });

  test("provides localized trial-balance labels for forced completion", () => {
    const keys = source("src/i18n/translationKeys.ts");
    const japanese = source("src/i18n/locales/ja.yaml");

    expect(keys).toContain('"ttCcStatementCompletionDesc"');
    expect(keys).toContain('"ttCcForceComplete"');
    expect(keys).toContain('"ttCcForceCompleteConfirm"');
    expect(japanese).toContain("ttCcForceComplete: 強制的に完了");
  });

  test("allows an uncompleted past gap after a later month was completed", () => {
    const route = source("../worker/src/routes/creditCardStatements.ts");

    expect(route).not.toContain("latestCompletedStatementMonth");
  });
});
