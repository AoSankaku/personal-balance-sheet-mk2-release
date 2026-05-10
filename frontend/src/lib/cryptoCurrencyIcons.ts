export const CRYPTO_ICON_STYLES = ["rich", "symbol"] as const;
export type CryptoIconStyle = (typeof CRYPTO_ICON_STYLES)[number];
export type CryptoIconSource = "si" | "fa" | "fa6" | "fallback";
export type CryptoIconKey =
  | "btc"
  | "eth"
  | "sol"
  | "bnb"
  | "usdt"
  | "usdc"
  | "xrp"
  | "ada"
  | "doge"
  | "dot"
  | "link"
  | "ltc"
  | "atom";

export const CRYPTO_ICON_STYLE_STORAGE_KEY = "crypto_currency_icon_style";

export interface CryptoCurrencyIconMeta {
  symbol: string;
  label: string;
  colors: [string, string];
  iconSource: CryptoIconSource;
  iconKey?: CryptoIconKey;
}

const CRYPTO_ICON_META: Record<string, CryptoCurrencyIconMeta> = {
  BTC: {
    symbol: "₿",
    label: "Bitcoin",
    colors: ["#f7931a", "#c46b00"],
    iconSource: "fa6",
    iconKey: "btc",
  },
  ETH: {
    symbol: "Ξ",
    label: "Ethereum",
    colors: ["#627eea", "#27346a"],
    iconSource: "si",
    iconKey: "eth",
  },
  SOL: {
    symbol: "◎",
    label: "Solana",
    colors: ["#2b155d", "#14f195"],
    iconSource: "si",
    iconKey: "sol",
  },
  SKR: {
    symbol: "S",
    label: "Seeker",
    colors: ["#10b981", "#0f766e"],
    iconSource: "fallback",
  },
  BNB: {
    symbol: "B",
    label: "BNB",
    colors: ["#f3ba2f", "#b7791f"],
    iconSource: "si",
    iconKey: "bnb",
  },
  USDT: {
    symbol: "₮",
    label: "Tether",
    colors: ["#26a17b", "#168363"],
    iconSource: "si",
    iconKey: "usdt",
  },
  USDC: {
    symbol: "$",
    label: "USD Coin",
    colors: ["#2775ca", "#1b4f9c"],
    iconSource: "si",
    iconKey: "usdc",
  },
  XRP: {
    symbol: "X",
    label: "XRP",
    colors: ["#23292f", "#5f6873"],
    iconSource: "si",
    iconKey: "xrp",
  },
  ADA: {
    symbol: "₳",
    label: "Cardano",
    colors: ["#0033ad", "#1f66ff"],
    iconSource: "si",
    iconKey: "ada",
  },
  DOGE: {
    symbol: "Ð",
    label: "Dogecoin",
    colors: ["#c2a633", "#8a6f1d"],
    iconSource: "si",
    iconKey: "doge",
  },
  AVAX: {
    symbol: "A",
    label: "Avalanche",
    colors: ["#e84142", "#a91f24"],
    iconSource: "fallback",
  },
  DOT: {
    symbol: "●",
    label: "Polkadot",
    colors: ["#e6007a", "#7a0bc0"],
    iconSource: "si",
    iconKey: "dot",
  },
  LINK: {
    symbol: "⬡",
    label: "Chainlink",
    colors: ["#2a5ada", "#1741a6"],
    iconSource: "si",
    iconKey: "link",
  },
  LTC: {
    symbol: "Ł",
    label: "Litecoin",
    colors: ["#345d9d", "#6f7f8f"],
    iconSource: "si",
    iconKey: "ltc",
  },
  ATOM: {
    symbol: "⚛",
    label: "Cosmos",
    colors: ["#2e3148", "#6f73a8"],
    iconSource: "fa6",
    iconKey: "atom",
  },
};

export function normalizeCryptoIconStyle(
  value: string | null | undefined,
): CryptoIconStyle {
  return value === "symbol" ? "symbol" : "rich";
}

export function getStoredCryptoIconStyle(): CryptoIconStyle {
  try {
    return normalizeCryptoIconStyle(
      localStorage.getItem(CRYPTO_ICON_STYLE_STORAGE_KEY),
    );
  } catch {
    return "rich";
  }
}

export function storeCryptoIconStyle(style: CryptoIconStyle): void {
  try {
    localStorage.setItem(CRYPTO_ICON_STYLE_STORAGE_KEY, style);
  } catch {}
}

export function getCryptoCurrencyIconMeta(
  code: string,
): CryptoCurrencyIconMeta {
  const normalized = code.toUpperCase();
  return (
    CRYPTO_ICON_META[normalized] ?? {
      symbol: normalized.slice(0, 1),
      label: normalized,
      colors: ["#64748b", "#334155"],
      iconSource: "fallback",
    }
  );
}
