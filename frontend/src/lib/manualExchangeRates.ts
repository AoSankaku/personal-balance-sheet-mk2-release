export const LS_MANUAL_EXCHANGE_RATES_KEY = "manual_exchange_rates"; // legacy (v1): { CODE: jpyPerUnit }
export const LS_MANUAL_EXCHANGE_RATES_V2_KEY = "manual_exchange_rates_v2"; // { CODE: { base, rate } }

export interface ManualExchangeRateSpec {
  /** Base currency code (e.g. "JPY", "USD") */
  base: string;
  /** 1 unit of CODE = rate units of base */
  rate: number;
}

export type ManualExchangeRateSpecs = Record<string, ManualExchangeRateSpec>;

function normalizeCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const code = value.trim().toUpperCase();
  return code ? code : null;
}

export function parseManualExchangeRate(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return value;
}

function parseManualExchangeRateSpec(value: unknown): ManualExchangeRateSpec | null {
  // Back-compat: v1 stored direct JPY-per-unit numbers.
  const legacy = parseManualExchangeRate(value);
  if (legacy !== null) return { base: "JPY", rate: legacy };

  if (!value || typeof value !== "object") return null;
  const obj = value as Record<string, unknown>;
  const base = normalizeCode(obj.base);
  const rate = parseManualExchangeRate(obj.rate);
  if (!base || rate === null) return null;
  return { base, rate };
}

function readSpecsV2(): ManualExchangeRateSpecs | null {
  try {
    const raw = localStorage.getItem(LS_MANUAL_EXCHANGE_RATES_V2_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const specs: ManualExchangeRateSpecs = {};
    for (const [rawCode, rawSpec] of Object.entries(parsed)) {
      const code = normalizeCode(rawCode);
      const spec = parseManualExchangeRateSpec(rawSpec);
      if (code && spec) specs[code] = spec;
    }
    return specs;
  } catch {
    return null;
  }
}

function readSpecsV1(): ManualExchangeRateSpecs {
  try {
    const raw = localStorage.getItem(LS_MANUAL_EXCHANGE_RATES_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const specs: ManualExchangeRateSpecs = {};
    for (const [rawCode, rawRate] of Object.entries(parsed)) {
      const code = normalizeCode(rawCode);
      const rate = parseManualExchangeRate(rawRate);
      if (code && rate !== null) specs[code] = { base: "JPY", rate };
    }
    return specs;
  } catch {
    return {};
  }
}

export function readManualExchangeRateSpecs(): ManualExchangeRateSpecs {
  const v2 = readSpecsV2();
  if (v2) return v2;

  const v1 = readSpecsV1();
  // Best-effort migration so the UI can show base/rate consistently.
  try {
    if (Object.keys(v1).length > 0) {
      localStorage.setItem(LS_MANUAL_EXCHANGE_RATES_V2_KEY, JSON.stringify(v1));
    }
  } catch {}
  return v1;
}

export function writeManualExchangeRateSpecs(specs: ManualExchangeRateSpecs) {
  const normalized: ManualExchangeRateSpecs = {};
  for (const [rawCode, rawSpec] of Object.entries(specs)) {
    const code = normalizeCode(rawCode);
    const base = normalizeCode(rawSpec?.base);
    const rate = parseManualExchangeRate(rawSpec?.rate);
    if (!code || !base || rate === null) continue;
    normalized[code] = { base, rate };
  }
  try {
    localStorage.setItem(
      LS_MANUAL_EXCHANGE_RATES_V2_KEY,
      JSON.stringify(normalized),
    );
    // Remove legacy key to avoid ambiguity.
    localStorage.removeItem(LS_MANUAL_EXCHANGE_RATES_KEY);
  } catch {}
  return normalized;
}

export function clearManualExchangeRates() {
  try {
    localStorage.removeItem(LS_MANUAL_EXCHANGE_RATES_V2_KEY);
    localStorage.removeItem(LS_MANUAL_EXCHANGE_RATES_KEY);
  } catch {}
  return {};
}
