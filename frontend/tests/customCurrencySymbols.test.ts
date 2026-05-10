import { describe, expect, test } from "bun:test";

import {
  CUSTOM_CURRENCY_ICON_OPTIONS,
  DEFAULT_CUSTOM_CURRENCY_ICON,
  fallbackSymbolForCustomCurrencyIcon,
  isCustomCurrencyIconOption,
  resolveCustomCurrencySymbol,
} from "../src/lib/customCurrencySymbols";

describe("custom currency icon and symbol options", () => {
  test("offers about twenty curated react-icons choices", () => {
    expect(CUSTOM_CURRENCY_ICON_OPTIONS).toHaveLength(20);
    expect(CUSTOM_CURRENCY_ICON_OPTIONS.some((option) => option.value === "circle")).toBe(
      true,
    );
    expect(CUSTOM_CURRENCY_ICON_OPTIONS.some((option) => option.value === "square")).toBe(
      true,
    );
    expect(CUSTOM_CURRENCY_ICON_OPTIONS.some((option) => option.value === "infinity")).toBe(
      true,
    );
  });

  test("uses a selectable default icon", () => {
    expect(isCustomCurrencyIconOption(DEFAULT_CUSTOM_CURRENCY_ICON)).toBe(true);
  });

  test("rejects ad hoc text outside the curated icon list", () => {
    expect(isCustomCurrencyIconOption("POINT")).toBe(false);
  });

  test("uses typed currency symbols before icon fallbacks", () => {
    expect(resolveCustomCurrencySymbol(" PT ", "circle")).toBe("PT");
    expect(resolveCustomCurrencySymbol("", "square")).toBe("[]");
    expect(fallbackSymbolForCustomCurrencyIcon("unknown")).toBe("o");
  });
});
