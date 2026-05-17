import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";

const appSource = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const contextSource = readFileSync(
  new URL("../src/context/AppDataContext.tsx", import.meta.url),
  "utf8",
);
const currencyPageSource = readFileSync(
  new URL("../src/pages/CurrencySettingsPage.tsx", import.meta.url),
  "utf8",
);

describe("currency initial setup gate", () => {
  test("waits until enabled currencies have been loaded before routing", () => {
    expect(contextSource).toContain("enabledCurrenciesLoaded");
    expect(appSource).toContain("enabledCurrenciesLoaded");
  });

  test("shows the initial currency setup page instead of normal routes when no currency is enabled", () => {
    expect(appSource).toContain("enabledCurrencies.length === 0");
    expect(appSource).toContain("<CurrencySettingsPage initialSetup");
    expect(currencyPageSource).toContain("initialSetup");
  });

  test("loads app data when currencies exist even if locale was not explicitly selected", () => {
    expect(contextSource).toContain(
      "enabledCurrenciesLoaded && enabledCurrencies.length > 0",
    );
    expect(contextSource).not.toContain(
      "hasExplicitLocale && enabledCurrenciesLoaded",
    );
  });

  test("does not allow disabling the final enabled currency from the settings page", () => {
    expect(currencyPageSource).toContain("enabledCurrencies.length <= 1");
    expect(currencyPageSource).toContain("disabled={removeDisabled}");
  });
});
