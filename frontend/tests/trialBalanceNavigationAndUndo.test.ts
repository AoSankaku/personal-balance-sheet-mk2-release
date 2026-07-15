import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const source = (path: string) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("trial-balance primary navigation and forced-completion undo", () => {
  test("exposes an undo action only for manual statement completions", () => {
    const actualInput = source("src/components/tt/ActualInputSection.tsx");
    const client = source("src/api/client.ts");
    const route = source("../worker/src/routes/creditCardStatements.ts");

    expect(actualInput).toContain(
      'completion.completion_method === "manual_confirmation"',
    );
    expect(actualInput).toContain(
      "api.creditCardStatements.cancelManualCompletion",
    );
    expect(actualInput).toContain('t("ttCcCancelForceComplete")');
    expect(client).toContain("cancelManualCompletion:");
    expect(route).toContain('router.delete("/completions/:id"');
    expect(route).toContain("creditCardStatementCompletions.completion_method");
    expect(route).toContain('"manual_confirmation"');
  });

  test("describes actual-amount comparison in every supported locale", () => {
    const labels = {
      "ja.yaml": [
        "tabTrialBalance: 試算表",
        "tabTrialBalanceDesc: 実際の金額と比較",
      ],
      "en.yaml": [
        "tabTrialBalance: Trial Balance",
        "tabTrialBalanceDesc: Compare with actual amounts",
      ],
      "fr.yaml": [
        'tabTrialBalance: "Balance de vérification"',
        'tabTrialBalanceDesc: "Comparer aux montants réels"',
      ],
      "es.yaml": [
        'tabTrialBalance: "Saldo de prueba"',
        'tabTrialBalanceDesc: "Comparar con importes reales"',
      ],
      "zh-CN.yaml": [
        "tabTrialBalance: 试算表",
        "tabTrialBalanceDesc: 与实际金额比较",
      ],
      "zh-TW.yaml": [
        "tabTrialBalance: 試算表",
        "tabTrialBalanceDesc: 與實際金額比較",
      ],
    } as const;

    for (const [file, expectedLines] of Object.entries(labels)) {
      const locale = source(`src/i18n/locales/${file}`);
      for (const expected of expectedLines) {
        expect(locale).toContain(expected);
      }
    }
  });

  test("places the trial-balance card first and makes it full-width and larger", () => {
    const assetsPage = source("src/pages/AssetsPage.tsx");
    const trialBalanceIndex = assetsPage.indexOf('to: "/fs/tt"');
    const balanceSheetIndex = assetsPage.indexOf('to: "/fs/bs"');

    expect(trialBalanceIndex).toBeGreaterThan(-1);
    expect(trialBalanceIndex).toBeLessThan(balanceSheetIndex);
    expect(assetsPage).toContain('const isTrialBalanceBtn = to === "/fs/tt"');
    expect(assetsPage).toContain(
      'gridColumn: isTrialBalanceBtn ? "1 / -1" : undefined',
    );
    expect(assetsPage).toContain(
      "padding: isTrialBalanceBtn ? rem(24) : rem(16)",
    );
  });
});
