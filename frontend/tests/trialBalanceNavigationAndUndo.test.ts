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

  test("describes book-to-actual balance reconciliation in every supported locale", () => {
    const labels = {
      "ja.yaml": [
        "tabTrialBalance: 残高照合",
        "tabTrialBalanceDesc: 帳簿と実際の残高を照合",
        "tabBudgetDesc: 予算の整合性を確認",
      ],
      "en.yaml": [
        "tabTrialBalance: Balance Reconciliation",
        "tabTrialBalanceDesc: Compare book and actual balances",
        "tabBudgetDesc: Check budget consistency",
      ],
      "fr.yaml": [
        'tabTrialBalance: "Rapprochement des soldes"',
        'tabTrialBalanceDesc: "Comparer les soldes comptables et réels"',
        'tabBudgetDesc: "Vérifier la cohérence du budget"',
      ],
      "es.yaml": [
        'tabTrialBalance: "Conciliación de saldos"',
        'tabTrialBalanceDesc: "Comparar saldos contables y reales"',
        'tabBudgetDesc: "Comprobar la coherencia del presupuesto"',
      ],
      "zh-CN.yaml": [
        "tabTrialBalance: 余额核对",
        "tabTrialBalanceDesc: 核对账面余额与实际余额",
        "tabBudgetDesc: 检查预算一致性",
      ],
      "zh-TW.yaml": [
        "tabTrialBalance: 餘額核對",
        "tabTrialBalanceDesc: 核對帳面餘額與實際餘額",
        "tabBudgetDesc: 檢查預算一致性",
      ],
    } as const;

    for (const [file, expectedLines] of Object.entries(labels)) {
      const locale = source(`src/i18n/locales/${file}`);
      for (const expected of expectedLines) {
        expect(locale).toContain(expected);
      }
    }
  });

  test("places balance reconciliation and budget side by side as primary destinations", () => {
    const assetsPage = source("src/pages/AssetsPage.tsx");
    const app = source("src/App.tsx");
    const budgetPage = source("src/pages/BudgetPage.tsx");
    const trialBalancePage = source("src/pages/TtPage.tsx");
    const trialBalanceIndex = assetsPage.indexOf('to: "/fs/tt"');
    const budgetIndex = assetsPage.indexOf('to: "/fs/budget"');
    const balanceSheetIndex = assetsPage.indexOf('to: "/fs/bs"');

    expect(trialBalanceIndex).toBeGreaterThan(-1);
    expect(budgetIndex).toBeGreaterThan(trialBalanceIndex);
    expect(budgetIndex).toBeLessThan(balanceSheetIndex);
    expect(trialBalanceIndex).toBeLessThan(balanceSheetIndex);
    expect(assetsPage).toContain('<SimpleGrid cols={{ base: 1, sm: 2 }}');
    expect(assetsPage).toContain('label: t("budgetTitle")');
    expect(assetsPage).toContain('desc: t("tabBudgetDesc")');
    expect(assetsPage).toContain('cols={{ base: 2, md: 4 }}');
    expect(assetsPage).not.toContain('to: "/fs/report"');
    expect(assetsPage).not.toContain('to: "/fs/crypto"');

    expect(app).toContain('path="/fs/budget"');
    expect(budgetPage).toContain("<BudgetCheckSection />");
    expect(budgetPage).not.toContain("<ActualInputSection");
    expect(trialBalancePage).not.toContain('value: "budget"');
    expect(trialBalancePage).toContain('to={`/fs/budget${legacyBudgetQuery}`}');
  });

  test("places optional crypto fetching after manual account inputs", () => {
    const actualInput = source("src/components/tt/ActualInputSection.tsx");
    const assetsIndex = actualInput.indexOf("{assetAccounts.length > 0");
    const liabilitiesIndex = actualInput.indexOf(
      "{liabilityAccounts.length > 0",
    );
    const cryptoFetchIndex = actualInput.indexOf(
      "{selectedCryptoChains.length > 0 && cryptoAccounts.length > 0",
    );

    expect(assetsIndex).toBeGreaterThan(-1);
    expect(liabilitiesIndex).toBeGreaterThan(assetsIndex);
    expect(cryptoFetchIndex).toBeGreaterThan(liabilitiesIndex);
    expect(actualInput).not.toContain(
      "mergeFetchedCryptoBalances(current, cryptoWallets, cryptoBalances)",
    );
  });

  test("fetches wallet quantities only for the crypto currency selected in the header", () => {
    const actualInput = source("src/components/tt/ActualInputSection.tsx");
    const context = source("src/context/AppDataContext.tsx");
    const walletModal = source("src/components/CryptoWatchModal.tsx");

    expect(actualInput).toContain(
      "walletsForCurrency(cryptoWallets, selectedCurrency)",
    );
    expect(actualInput).toContain("visibleCryptoWallets.map((wallet)");
    expect(actualInput).toContain("currency: selectedCurrency");
    expect(actualInput).toContain(
      "normalizeCurrency(line.currency) !== selectedCurrency",
    );
    expect(actualInput).not.toContain("refreshCryptoBalances");
    expect(context).not.toContain("refreshCryptoBalances");
    expect(context).not.toContain("cryptoBalances");
    expect(walletModal).toContain("currency: string");
    expect(walletModal).not.toContain("formatJPY");
    expect(walletModal).not.toContain("estMarketValue");
    expect(walletModal).not.toContain("coinPrice");
  });
});
