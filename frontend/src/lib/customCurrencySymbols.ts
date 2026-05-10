export type CustomCurrencyIconKey =
  | "circle"
  | "circleDot"
  | "square"
  | "diamond"
  | "star"
  | "heart"
  | "bolt"
  | "shield"
  | "plus"
  | "minus"
  | "xmark"
  | "check"
  | "asterisk"
  | "at"
  | "hashtag"
  | "percent"
  | "infinity"
  | "equals"
  | "slash"
  | "wave";

export interface CustomCurrencyIconOption {
  value: CustomCurrencyIconKey;
  label: string;
  fallbackSymbol: string;
}

export const CUSTOM_CURRENCY_ICON_OPTIONS: CustomCurrencyIconOption[] = [
  { value: "circle", label: "Circle", fallbackSymbol: "o" },
  { value: "circleDot", label: "Dot circle", fallbackSymbol: "." },
  { value: "square", label: "Square", fallbackSymbol: "[]" },
  { value: "diamond", label: "Diamond", fallbackSymbol: "<>" },
  { value: "star", label: "Star", fallbackSymbol: "*" },
  { value: "heart", label: "Heart", fallbackSymbol: "<3" },
  { value: "bolt", label: "Bolt", fallbackSymbol: "!" },
  { value: "shield", label: "Shield", fallbackSymbol: "#" },
  { value: "plus", label: "Plus", fallbackSymbol: "+" },
  { value: "minus", label: "Minus", fallbackSymbol: "-" },
  { value: "xmark", label: "X mark", fallbackSymbol: "x" },
  { value: "check", label: "Check", fallbackSymbol: "v" },
  { value: "asterisk", label: "Asterisk", fallbackSymbol: "*" },
  { value: "at", label: "At", fallbackSymbol: "@" },
  { value: "hashtag", label: "Hashtag", fallbackSymbol: "#" },
  { value: "percent", label: "Percent", fallbackSymbol: "%" },
  { value: "infinity", label: "Infinity", fallbackSymbol: "inf" },
  { value: "equals", label: "Equals", fallbackSymbol: "=" },
  { value: "slash", label: "Slash", fallbackSymbol: "/" },
  { value: "wave", label: "Wave", fallbackSymbol: "~" },
];

export const DEFAULT_CUSTOM_CURRENCY_ICON =
  CUSTOM_CURRENCY_ICON_OPTIONS[0].value;

export function isCustomCurrencyIconOption(
  icon: string | null | undefined,
): icon is CustomCurrencyIconKey {
  return CUSTOM_CURRENCY_ICON_OPTIONS.some((option) => option.value === icon);
}

export function fallbackSymbolForCustomCurrencyIcon(
  icon: string | null | undefined,
): string {
  return (
    CUSTOM_CURRENCY_ICON_OPTIONS.find((option) => option.value === icon)
      ?.fallbackSymbol ??
    CUSTOM_CURRENCY_ICON_OPTIONS.find(
      (option) => option.value === DEFAULT_CUSTOM_CURRENCY_ICON,
    )!.fallbackSymbol
  );
}

export function resolveCustomCurrencySymbol(
  symbol: string | null | undefined,
  icon: string | null | undefined,
): string {
  const trimmed = symbol?.trim();
  return trimmed || fallbackSymbolForCustomCurrencyIcon(icon);
}
