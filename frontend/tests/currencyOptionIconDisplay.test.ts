import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

import { CURRENCY_SYMBOLS } from "../src/lib/currencyUtils";
import {
  getCurrencyBadgeText,
  isCryptoCurrencyIconCode,
} from "../src/lib/currencyIconDisplay";

const frontendRoot = join(import.meta.dir, "..");

describe("currency option icon display", () => {
  test("uses compact currency symbols before ISO code fallbacks", () => {
    expect(getCurrencyBadgeText("JPY", CURRENCY_SYMBOLS.JPY)).toBe(
      CURRENCY_SYMBOLS.JPY,
    );
    expect(getCurrencyBadgeText("MXN", "Mex$")).toBe("MXN");
    expect(getCurrencyBadgeText("POINTS", "")).toBe("P");
  });

  test("keeps crypto currencies on their branded icon path", () => {
    expect(isCryptoCurrencyIconCode("btc")).toBe(true);
    expect(isCryptoCurrencyIconCode("JPY")).toBe(false);
  });

  test("does not use country flags for currency selectors", () => {
    const topNav = readFileSync(
      join(frontendRoot, "src/components/TopNav.tsx"),
      "utf8",
    );
    const settingsPage = readFileSync(
      join(frontendRoot, "src/pages/CurrencySettingsPage.tsx"),
      "utf8",
    );

    expect(topNav).not.toContain("country-flag-icons/react/3x2");
    expect(settingsPage).not.toContain("country-flag-icons/react/3x2");
  });
});
