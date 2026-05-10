export type MoneyField = {
  path: string;
  value: unknown;
  currency?: string | null;
  decimalPlaces?: number | null;
  nullable?: boolean;
};

export type MoneyScaleOptions = {
  decimalPlaces?: number | null;
  decimalPlacesByCurrency?: Record<string, number | null | undefined>;
};

const CRYPTO_SCALE_BY_CURRENCY: Record<string, number> = {
  USDT: 6,
  USDC: 6,
  BTC: 8,
  ETH: 8,
  BNB: 8,
  SOL: 9,
  SKR: 9,
};

const EPSILON = 1e-9;
const DEFAULT_MONEY_SCALE = 2;
const intlScaleCache = new Map<string, number | null>();

export function normalizeMoneyCurrency(currency: string | null | undefined) {
  return (currency || "JPY").toUpperCase();
}

function normalizeDecimalPlaces(value: number | null | undefined) {
  if (value == null) return null;
  if (!Number.isInteger(value) || value < 0 || value > 9) return null;
  return value;
}

function intlMoneyScale(currency: string): number | null {
  const cached = intlScaleCache.get(currency);
  if (cached !== undefined) return cached;

  try {
    const options = new Intl.NumberFormat("en", {
      style: "currency",
      currency,
    }).resolvedOptions();
    const scale = options.maximumFractionDigits;
    intlScaleCache.set(currency, scale);
    return scale;
  } catch {
    intlScaleCache.set(currency, null);
    return null;
  }
}

export function moneyScale(
  currency: string | null | undefined,
  options: MoneyScaleOptions = {},
): number {
  const normalized = normalizeMoneyCurrency(currency);
  const directOverride = normalizeDecimalPlaces(options.decimalPlaces);
  if (directOverride !== null) return directOverride;

  const mapOverride = normalizeDecimalPlaces(
    options.decimalPlacesByCurrency?.[normalized],
  );
  if (mapOverride !== null) return mapOverride;

  const cryptoScale = CRYPTO_SCALE_BY_CURRENCY[normalized];
  if (cryptoScale !== undefined) return cryptoScale;

  return intlMoneyScale(normalized) ?? DEFAULT_MONEY_SCALE;
}

function scaleFactor(
  currency: string | null | undefined,
  options: MoneyScaleOptions = {},
): number {
  return 10 ** moneyScale(currency, options);
}

export function toStorageMoneyAmount(
  value: number,
  currency: string | null | undefined,
  options: MoneyScaleOptions = {},
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error("invalid money amount");
  }

  const factor = scaleFactor(currency, options);
  const scaled = value * factor;
  const rounded = Math.round(scaled);
  if (Math.abs(scaled - rounded) > EPSILON) {
    throw new Error("invalid money precision");
  }
  if (!Number.isSafeInteger(rounded)) {
    throw new Error("money amount exceeds safe integer range");
  }
  return rounded;
}

export function fromStorageMoneyAmount(
  value: number,
  currency: string | null | undefined,
  options: MoneyScaleOptions = {},
): number {
  return value / scaleFactor(currency, options);
}

export function rescaleStorageMoneyAmount(
  value: number | null,
  fromCurrency: string | null | undefined,
  toCurrency: string | null | undefined,
  options: MoneyScaleOptions = {},
): number | null {
  if (value == null) return null;
  return toStorageMoneyAmount(
    fromStorageMoneyAmount(value, fromCurrency, options),
    toCurrency,
    options,
  );
}

export function findInvalidMoney(fields: MoneyField[]): MoneyField | null {
  for (const field of fields) {
    if (field.value === undefined) continue;
    if (field.value === null) {
      if (field.nullable) continue;
      return field;
    }
    try {
      toStorageMoneyAmount(field.value as number, field.currency, {
        decimalPlaces: field.decimalPlaces,
      });
    } catch {
      return field;
    }
  }
  return null;
}

export function findInvalidMoneyField(fields: MoneyField[]): string | null {
  return findInvalidMoney(fields)?.path ?? null;
}

export function invalidMoneyResponse(
  field: string,
  currency?: string | null,
) {
  const normalizedCurrency = normalizeMoneyCurrency(currency);
  return {
    error: "invalid_money_amount",
    field,
    currency: normalizedCurrency,
    message: `${field} must be a valid ${normalizedCurrency} amount`,
  };
}
