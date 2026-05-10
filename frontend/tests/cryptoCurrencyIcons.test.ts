import { describe, expect, test } from "bun:test";

import {
  CRYPTO_ICON_STYLE_STORAGE_KEY,
  CRYPTO_ICON_STYLES,
  getCryptoCurrencyIconMeta,
  normalizeCryptoIconStyle,
} from "../src/lib/cryptoCurrencyIcons";

describe("crypto currency icon preferences", () => {
  test("supports rich exchange-style icons and white symbol icons", () => {
    expect(CRYPTO_ICON_STYLES).toEqual(["rich", "symbol"]);
    expect(CRYPTO_ICON_STYLE_STORAGE_KEY).toBe("crypto_currency_icon_style");
  });

  test("normalizes invalid icon style values to rich", () => {
    expect(normalizeCryptoIconStyle("symbol")).toBe("symbol");
    expect(normalizeCryptoIconStyle("rich")).toBe("rich");
    expect(normalizeCryptoIconStyle("plain")).toBe("rich");
    expect(normalizeCryptoIconStyle(null)).toBe("rich");
  });

  test("provides branded metadata for enabled crypto currencies", () => {
    expect(getCryptoCurrencyIconMeta("BTC")).toMatchObject({
      symbol: "₿",
      label: "Bitcoin",
      iconSource: "fa6",
    });
    expect(getCryptoCurrencyIconMeta("USDT")).toMatchObject({
      symbol: "₮",
      label: "Tether",
      iconSource: "si",
    });
  });

  test("falls back to a deterministic symbol for unknown codes", () => {
    expect(getCryptoCurrencyIconMeta("ZZZ")).toMatchObject({
      symbol: "Z",
      label: "ZZZ",
      iconSource: "fallback",
    });
  });

  test("prefers Simple Icons, then Font Awesome, then local fallback", () => {
    expect(getCryptoCurrencyIconMeta("ETH").iconSource).toBe("si");
    expect(getCryptoCurrencyIconMeta("USDC").iconSource).toBe("si");
    expect(getCryptoCurrencyIconMeta("BTC").iconSource).toBe("fa6");
    expect(getCryptoCurrencyIconMeta("ATOM").iconSource).toBe("fa6");
    expect(getCryptoCurrencyIconMeta("SKR").iconSource).toBe("fallback");
  });
});
