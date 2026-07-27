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
      ],
      "en.yaml": [
        "tabTrialBalance: Balance Reconciliation",
        "tabTrialBalanceDesc: Compare book and actual balances",
      ],
      "fr.yaml": [
        'tabTrialBalance: "Rapprochement des soldes"',
        'tabTrialBalanceDesc: "Comparer les soldes comptables et réels"',
      ],
      "es.yaml": [
        'tabTrialBalance: "Conciliación de saldos"',
        'tabTrialBalanceDesc: "Comparar saldos contables y reales"',
      ],
      "zh-CN.yaml": [
        "tabTrialBalance: 余额核对",
        "tabTrialBalanceDesc: 核对账面余额与实际余额",
      ],
      "zh-TW.yaml": [
        "tabTrialBalance: 餘額核對",
        "tabTrialBalanceDesc: 核對帳面餘額與實際餘額",
      ],
    } as const;

    for (const [file, expectedLines] of Object.entries(labels)) {
      const locale = source(`src/i18n/locales/${file}`);
      for (const expected of expectedLines) {
        expect(locale).toContain(expected);
      }
    }
  });

  test("keeps balance reconciliation prominent and hides the undecided report card", () => {
    const assetsPage = source("src/pages/AssetsPage.tsx");
    const trialBalanceIndex = assetsPage.indexOf('to: "/fs/tt"');
    const balanceSheetIndex = assetsPage.indexOf('to: "/fs/bs"');

    expect(trialBalanceIndex).toBeGreaterThan(-1);
    expect(trialBalanceIndex).toBeLessThan(balanceSheetIndex);
    expect(assetsPage).toContain('const isTrialBalanceBtn = to === "/fs/tt"');
    expect(assetsPage).toContain(
      'variant={isTrialBalanceBtn ? "light" : "default"}',
    );
    expect(assetsPage).toContain(
      'gridColumn: isTrialBalanceBtn ? "1 / -1" : undefined',
    );
    expect(assetsPage).toContain(
      "padding: isTrialBalanceBtn ? rem(24) : rem(16)",
    );
    expect(assetsPage).toContain("size={isTrialBalanceBtn ? 64 : 48}");
    expect(assetsPage).toContain('cols={{ base: 2, md: 4 }}');
    expect(assetsPage).not.toContain('to: "/fs/report"');
    expect(assetsPage).not.toContain('to: "/fs/crypto"');
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
