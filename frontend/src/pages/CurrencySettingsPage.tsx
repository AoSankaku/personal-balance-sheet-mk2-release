import { useEffect, useMemo, useState } from "react";
import type React from "react";
import {
  Badge,
  Code,
  Divider,
  Group,
  NumberInput,
  Paper,
  SegmentedControl,
  Select,
  Stack,
  Text,
  TextInput,
  Title,
  ActionIcon,
  Alert,
  Anchor,
  Tooltip,
} from "@mantine/core";
import {
  IconArrowDown,
  IconArrowUp,
  IconCheck,
  IconInfoCircle,
  IconPlus,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import * as Flags from "country-flag-icons/react/3x2";
import { Link } from "react-router-dom";
import type { EnabledCurrency } from "@balance-sheet/shared";
import { useAppData } from "../context/AppDataContext";
import { useLang } from "../i18n";
import { api } from "../api/client";
import {
  LS_CRYPTO_PROVIDER_KEY,
  getCryptoProvider,
  type CryptoProvider,
} from "../hooks/useCryptoPrices";
import {
  LS_FIAT_PROVIDER_KEY,
  getFiatProvider,
  type FiatProvider,
} from "../hooks/useExchangeRates";
import { formatCurrency } from "../lib/numberFormat";
import { CURRENCY_SYMBOLS, getEffectiveSymbol } from "../lib/currencyUtils";
import { CryptoCurrencyIcon } from "../components/CryptoCurrencyIcon";
import { CustomCurrencyIcon } from "../components/CustomCurrencyIcon";
import type { CryptoIconStyle } from "../lib/cryptoCurrencyIcons";
import {
  CUSTOM_CURRENCY_ICON_OPTIONS,
  DEFAULT_CUSTOM_CURRENCY_ICON,
  fallbackSymbolForCustomCurrencyIcon,
  isCustomCurrencyIconOption,
  resolveCustomCurrencySymbol,
} from "../lib/customCurrencySymbols";

// Symbols that are placed before the number (prefix)
const PREFIX_SYMBOLS = new Set([
  "$",
  "€",
  "£",
  "¥",
  "₩",
  "₿",
  "Ξ",
  "₮",
  "₱",
  "₹",
  "₺",
  "₳",
  "Ð",
  "Ł",
  "◎",
  "฿",
  "A$",
  "C$",
  "HK$",
  "NZ$",
  "S$",
  "Mex$",
  "R$",
  "Rp",
  "RM",
  "R",
  "Fr.",
]);

/** Format a net-asset amount with its effective symbol. */
function formatAmount(amount: number, code: string, sym: string): string {
  const noDecimals = ["JPY", "KRW", "HUF", "IDR", "VND", "CLP"].includes(code);
  const abs = Math.abs(amount);
  const numStr = abs.toLocaleString("en", {
    minimumFractionDigits: 0,
    maximumFractionDigits: noDecimals ? 0 : 2,
  });
  const sign = amount < -0.000001 ? "-" : "";
  return PREFIX_SYMBOLS.has(sym)
    ? `${sign}${sym}${numStr}`
    : `${sign}${numStr} ${sym}`;
}

// ── Flag / Crypto icon helpers ───────────────────────────────────────────────

const CURRENCY_TO_COUNTRY: Record<string, string> = {
  JPY: "JP",
  USD: "US",
  EUR: "EU",
  GBP: "GB",
  AUD: "AU",
  CAD: "CA",
  CHF: "CH",
  CNY: "CN",
  HKD: "HK",
  KRW: "KR",
  SGD: "SG",
  THB: "TH",
  IDR: "ID",
  MYR: "MY",
  PHP: "PH",
  INR: "IN",
  SEK: "SE",
  NOK: "NO",
  DKK: "DK",
  NZD: "NZ",
  MXN: "MX",
  BRL: "BR",
  ZAR: "ZA",
  TRY: "TR",
  PLN: "PL",
  CZK: "CZ",
  HUF: "HU",
};

function FlagIcon({ code }: { code: string }) {
  const country = CURRENCY_TO_COUNTRY[code];
  if (!country) return <span style={{ width: 22, display: "inline-block" }} />;
  const Flag = (
    Flags as unknown as Record<
      string,
      React.ComponentType<{ style?: React.CSSProperties }>
    >
  )[country];
  if (!Flag) return <span style={{ width: 22, display: "inline-block" }} />;
  return <Flag style={{ width: 22, height: "auto", display: "block" }} />;
}

function CryptoIcon({ symbol }: { symbol: string }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 22,
        height: 22,
        fontSize: 14,
        lineHeight: 1,
        flexShrink: 0,
      }}
    >
      {symbol}
    </span>
  );
}

// ── Currency lists ────────────────────────────────────────────────────────────

const FIAT_CURRENCIES: { code: string; name: string; nameJa: string }[] = [
  { code: "JPY", name: "Japanese Yen", nameJa: "日本円" },
  { code: "USD", name: "US Dollar", nameJa: "米ドル" },
  { code: "EUR", name: "Euro", nameJa: "ユーロ" },
  { code: "GBP", name: "British Pound", nameJa: "英ポンド" },
  { code: "AUD", name: "Australian Dollar", nameJa: "豪ドル" },
  { code: "CAD", name: "Canadian Dollar", nameJa: "カナダドル" },
  { code: "CHF", name: "Swiss Franc", nameJa: "スイスフラン" },
  { code: "CNY", name: "Chinese Yuan", nameJa: "人民元" },
  { code: "HKD", name: "Hong Kong Dollar", nameJa: "香港ドル" },
  { code: "KRW", name: "South Korean Won", nameJa: "韓国ウォン" },
  { code: "SGD", name: "Singapore Dollar", nameJa: "シンガポールドル" },
  { code: "THB", name: "Thai Baht", nameJa: "タイバーツ" },
  { code: "IDR", name: "Indonesian Rupiah", nameJa: "インドネシアルピア" },
  { code: "MYR", name: "Malaysian Ringgit", nameJa: "マレーシアリンギット" },
  { code: "PHP", name: "Philippine Peso", nameJa: "フィリピンペソ" },
  { code: "INR", name: "Indian Rupee", nameJa: "インドルピー" },
  { code: "SEK", name: "Swedish Krona", nameJa: "スウェーデンクローナ" },
  { code: "NOK", name: "Norwegian Krone", nameJa: "ノルウェークローネ" },
  { code: "DKK", name: "Danish Krone", nameJa: "デンマーククローネ" },
  { code: "NZD", name: "New Zealand Dollar", nameJa: "ニュージーランドドル" },
  { code: "MXN", name: "Mexican Peso", nameJa: "メキシコペソ" },
  { code: "BRL", name: "Brazilian Real", nameJa: "ブラジルレアル" },
  { code: "ZAR", name: "South African Rand", nameJa: "南アフリカランド" },
  { code: "TRY", name: "Turkish Lira", nameJa: "トルコリラ" },
  { code: "PLN", name: "Polish Zloty", nameJa: "ポーランドズロチ" },
  { code: "CZK", name: "Czech Koruna", nameJa: "チェココルナ" },
  { code: "HUF", name: "Hungarian Forint", nameJa: "ハンガリーフォリント" },
];

const CRYPTO_CURRENCIES: {
  code: string;
  name: string;
  nameJa: string;
  icon: string;
}[] = [
  { code: "BTC", name: "Bitcoin", nameJa: "ビットコイン", icon: "₿" },
  { code: "ETH", name: "Ethereum", nameJa: "イーサリアム", icon: "Ξ" },
  { code: "SOL", name: "Solana", nameJa: "ソラナ", icon: "◎" },
  { code: "SKR", name: "Seeker (SKR)", nameJa: "シーカー", icon: "🔍" },
  { code: "BNB", name: "BNB", nameJa: "BNB", icon: "🔶" },
  { code: "USDT", name: "Tether (USDT)", nameJa: "テザー", icon: "₮" },
  { code: "USDC", name: "USD Coin (USDC)", nameJa: "USDコイン", icon: "🔵" },
  { code: "XRP", name: "XRP", nameJa: "XRP", icon: "◈" },
  { code: "ADA", name: "Cardano", nameJa: "カルダノ", icon: "₳" },
  { code: "DOGE", name: "Dogecoin", nameJa: "ドージコイン", icon: "Ð" },
  { code: "AVAX", name: "Avalanche", nameJa: "アバランチ", icon: "🔺" },
  { code: "DOT", name: "Polkadot", nameJa: "ポルカドット", icon: "●" },
  { code: "LINK", name: "Chainlink", nameJa: "チェーンリンク", icon: "⬡" },
  { code: "LTC", name: "Litecoin", nameJa: "ライトコイン", icon: "Ł" },
  { code: "ATOM", name: "Cosmos", nameJa: "コスモス", icon: "⚛" },
];

const KNOWN_CODES = new Set([
  ...FIAT_CURRENCIES.map((c) => c.code),
  ...CRYPTO_CURRENCIES.map((c) => c.code),
]);

const CRYPTO_CODE_SET = new Set(CRYPTO_CURRENCIES.map((c) => c.code));

// ── Component ────────────────────────────────────────────────────────────────

type CurrencySettingsPageProps = {
  initialSetup?: boolean;
};

export default function CurrencySettingsPage({
  initialSetup = false,
}: CurrencySettingsPageProps) {
  const { t, locale } = useLang();
  const {
    accounts,
    enabledCurrencies,
    refreshEnabledCurrencies,
    forceRefreshCryptoPrices,
    forceRefreshRates,
    displayCurrency,
    cryptoIconStyle,
    setCryptoIconStyle,
    exchangeRates,
    manualExchangeRates,
    setManualExchangeRate,
    ratesCooldown,
    pricesCooldown,
  } = useAppData();
  const [loading, setLoading] = useState<string | null>(null);
  const [customCode, setCustomCode] = useState("");
  const [customIcon, setCustomIcon] = useState(DEFAULT_CUSTOM_CURRENCY_ICON);
  const [customSymbol, setCustomSymbol] = useState("");
  const [customDecimalPlaces, setCustomDecimalPlaces] = useState<number | string>(
    2,
  );
  const [selectedKnownCode, setSelectedKnownCode] = useState<string | null>(
    null,
  );
  const [cryptoProvider, setCryptoProvider] =
    useState<CryptoProvider>(getCryptoProvider);
  const [fiatProvider, setFiatProvider] =
    useState<FiatProvider>(getFiatProvider);
  const [providerMsg, setProviderMsg] = useState<string | null>(null);
  const [manualRateInputs, setManualRateInputs] = useState<
    Record<string, number | string>
  >({});

  const enabledSet = new Set(enabledCurrencies.map((c) => c.code));

  const nonZeroCurrencies = useMemo(() => {
    const set = new Set<string>();
    for (const account of accounts) {
      if (!account.balances) continue;
      for (const [currency, balance] of Object.entries(account.balances)) {
        if (Math.abs(balance) > 0.000001) set.add(currency);
      }
    }
    return set;
  }, [accounts]);

  const customEnabled = useMemo(
    () => enabledCurrencies.filter((c) => !KNOWN_CODES.has(c.code)),
    [enabledCurrencies],
  );
  const customCodeSet = useMemo(
    () => new Set(customEnabled.map((currency) => currency.code)),
    [customEnabled],
  );

  useEffect(() => {
    setManualRateInputs((prev) => {
      const next: Record<string, number | string> = {};
      for (const currency of customEnabled) {
        next[currency.code] =
          prev[currency.code] ?? manualExchangeRates[currency.code] ?? "";
      }
      return next;
    });
  }, [customEnabled, manualExchangeRates]);

  const knownCurrencyOptions = useMemo(() => {
    const options = [
      {
        group: t("currencySettingsFiatGroup"),
        items: FIAT_CURRENCIES.filter((c) => !enabledSet.has(c.code)).map(
          (c) => ({
            value: c.code,
            label: `${c.code} - ${locale === "ja" ? c.nameJa : c.name}`,
          }),
        ),
      },
      {
        group: t("currencySettingsCryptoGroup"),
        items: CRYPTO_CURRENCIES.filter((c) => !enabledSet.has(c.code)).map(
          (c) => ({
            value: c.code,
            label: `${c.code} - ${locale === "ja" ? c.nameJa : c.name}`,
          }),
        ),
      },
    ];
    return options.filter((group) => group.items.length > 0);
  }, [enabledSet, locale, t]);

  const customCurrencyIconOptions = useMemo(
    () =>
      CUSTOM_CURRENCY_ICON_OPTIONS.map((option) => ({
        value: option.value,
        label: `${option.label} (${option.fallbackSymbol})`,
      })),
    [],
  );

  const rateStatusRows = useMemo(() => {
    const baseCode = displayCurrency || enabledCurrencies[0]?.code || "JPY";
    const baseRate = baseCode === "JPY" ? 1 : (exchangeRates[baseCode] ?? 0);
    const hasBaseRate = baseRate > 0;

    return enabledCurrencies.map((currency) => {
      const code = currency.code;
      const rate = code === "JPY" ? 1 : (exchangeRates[code] ?? 0);
      const hasRate = rate > 0;
      const isCrypto = CRYPTO_CODE_SET.has(code);
      const isCustom = customCodeSet.has(code);

      let quote = locale === "ja" ? "未取得" : "Not fetched";
      if (code === baseCode) {
        quote = `1 ${baseCode} = 1 ${baseCode}`;
      } else if (hasBaseRate && hasRate) {
        quote = isCrypto || isCustom
          ? `1 ${code} = ${formatCurrency(rate / baseRate, locale, baseCode)}`
          : `1 ${baseCode} = ${formatCurrency(baseRate / rate, locale, code)}`;
      }

      return {
        code,
        hasRate,
        isCrypto,
        isCustom,
        quote,
      };
    });
  }, [customCodeSet, displayCurrency, enabledCurrencies, exchangeRates, locale]);

  function renderRateQuote(quote: string) {
    const match = quote.match(/^(.*?)(\.\d+)(\s?[A-Z]{2,6})?$/);
    if (!match) return quote;

    return (
      <>
        {match[1]}
        <Text span size="xs" ff="monospace">
          {match[2]}
        </Text>
        {match[3] ?? ""}
      </>
    );
  }

  // Net assets (assets − liabilities) per currency, from journal_lines data in accounts
  const netAssetsByCurrency = useMemo(() => {
    const map: Record<string, number> = {};
    for (const acc of accounts) {
      if (acc.type !== "asset" && acc.type !== "liability") continue;
      if (!acc.balances) continue;
      for (const [currency, bal] of Object.entries(acc.balances)) {
        map[currency] =
          (map[currency] ?? 0) + (acc.type === "asset" ? bal : -bal);
      }
    }
    return map;
  }, [accounts]);

  // Detect symbol conflicts among currently enabled currencies (including custom symbols)
  const symbolConflicts = useMemo(() => {
    const bySymbol: Record<string, EnabledCurrency[]> = {};
    for (const c of enabledCurrencies) {
      const sym =
        c.custom_symbol ||
        (c.custom_icon
          ? fallbackSymbolForCustomCurrencyIcon(c.custom_icon)
          : CURRENCY_SYMBOLS[c.code]);
      if (!sym) continue;
      (bySymbol[sym] ??= []).push(c);
    }
    return Object.entries(bySymbol)
      .filter(([, list]) => list.length > 1)
      .map(([symbol, list]) => ({ symbol, list }));
  }, [enabledCurrencies]);

  function getPrimary(list: EnabledCurrency[]): string {
    return [...list].sort(
      (a, b) =>
        b.symbol_priority - a.symbol_priority || a.sort_order - b.sort_order,
    )[0].code;
  }

  async function toggle(code: string, enabled: boolean) {
    if (loading) return;
    if (!enabled && nonZeroCurrencies.has(code)) return;
    if (!enabled && enabledCurrencies.length <= 1) return;
    setLoading(code);
    try {
      await api.currencies.toggle(code, enabled);
      await refreshEnabledCurrencies();
    } catch {
      // ignore
    } finally {
      setLoading(null);
    }
  }

  async function addKnownCurrency() {
    if (!selectedKnownCode || enabledSet.has(selectedKnownCode)) return;
    await toggle(selectedKnownCode, true);
    setSelectedKnownCode(null);
  }

  async function addCustom() {
    const code = customCode.trim().toUpperCase();
    if (!code || enabledSet.has(code)) return;
    const icon = isCustomCurrencyIconOption(customIcon)
      ? customIcon
      : DEFAULT_CUSTOM_CURRENCY_ICON;
    const sym = customSymbol.trim() || undefined;
    const decimalPlaces = Number(customDecimalPlaces);
    if (!Number.isInteger(decimalPlaces) || decimalPlaces < 0 || decimalPlaces > 9) {
      return;
    }
    setLoading(code);
    try {
      await api.currencies.toggle(code, true, sym, decimalPlaces, icon);
      await refreshEnabledCurrencies();
    } catch {
      // ignore
    } finally {
      setLoading(null);
    }
    setCustomCode("");
    setCustomIcon(DEFAULT_CUSTOM_CURRENCY_ICON);
    setCustomSymbol("");
    setCustomDecimalPlaces(2);
  }

  async function handleCryptoProviderChange(value: string | null) {
    if (!value || value === cryptoProvider) return;
    const p = value as CryptoProvider;
    try {
      localStorage.setItem(LS_CRYPTO_PROVIDER_KEY, p);
    } catch {}
    setCryptoProvider(p);
    setProviderMsg(t("currencySettingsApiApplied"));
    await forceRefreshCryptoPrices();
    setTimeout(() => setProviderMsg(null), 3000);
  }

  async function handleFiatProviderChange(value: string | null) {
    if (!value || value === fiatProvider) return;
    const p = value as FiatProvider;
    try {
      localStorage.setItem(LS_FIAT_PROVIDER_KEY, p);
    } catch {}
    setFiatProvider(p);
    setProviderMsg(t("currencySettingsApiApplied"));
    await forceRefreshRates();
    setTimeout(() => setProviderMsg(null), 3000);
  }

  function updateManualRateInput(code: string, value: number | string) {
    setManualRateInputs((prev) => ({ ...prev, [code]: value }));
  }

  function saveManualRate(code: string) {
    const raw = manualRateInputs[code];
    const rate = Number(raw);
    if (!Number.isFinite(rate) || rate <= 0) return;
    setManualExchangeRate(code, rate);
  }

  function clearManualRate(code: string) {
    updateManualRateInput(code, "");
    setManualExchangeRate(code, null);
  }

  async function setPrimary(symbol: string, primaryCode: string) {
    const group = symbolConflicts.find((g) => g.symbol === symbol);
    if (!group) return;
    await Promise.all(
      group.list.map((c) =>
        api.currencies.setPriority(c.code, c.code === primaryCode ? 1 : 0),
      ),
    );
    await refreshEnabledCurrencies();
  }

  const isLastEnabled = enabledCurrencies.length <= 1;

  const disabledReasonBalance =
    locale === "ja"
      ? "残高があるため無効化できません"
      : "Cannot disable: has non-zero balance";
  const disabledReasonLast =
    locale === "ja"
      ? "最後の通貨は削除できません（最低1つ必要です）"
      : "Cannot disable the last currency — at least one is required";

  function getCurrencyLabel(code: string): string {
    const fiat = FIAT_CURRENCIES.find((currency) => currency.code === code);
    if (fiat)
      return locale === "ja" ? `${fiat.nameJa} / ${fiat.name}` : fiat.name;
    const crypto = CRYPTO_CURRENCIES.find((currency) => currency.code === code);
    if (crypto)
      return locale === "ja"
        ? `${crypto.nameJa} / ${crypto.name}`
        : crypto.name;
    const custom = enabledCurrencies.find((currency) => currency.code === code);
    return custom
      ? `${code} (${resolveCustomCurrencySymbol(custom.custom_symbol, custom.custom_icon)})`
      : code;
  }

  function getCurrencyIcon(code: string) {
    if (CRYPTO_CODE_SET.has(code)) {
      return (
        <CryptoCurrencyIcon
          code={code}
          styleMode={cryptoIconStyle}
          size={22}
        />
      );
    }
    if (FIAT_CURRENCIES.some((currency) => currency.code === code)) {
      return <FlagIcon code={code} />;
    }
    const custom = enabledCurrencies.find((currency) => currency.code === code);
    return <CustomCurrencyIcon icon={custom?.custom_icon} size={22} />;
  }

  async function reorderCurrencies(codes: string[]) {
    setLoading("__order__");
    try {
      await api.currencies.reorder(codes);
      await refreshEnabledCurrencies();
    } catch {
      // ignore
    } finally {
      setLoading(null);
    }
  }

  async function moveCurrency(index: number, direction: -1 | 1) {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= enabledCurrencies.length) return;
    const codes = enabledCurrencies.map((currency) => currency.code);
    [codes[index], codes[nextIndex]] = [codes[nextIndex]!, codes[index]!];
    await reorderCurrencies(codes);
  }

  function CurrencyListRow({
    currency,
    index,
  }: {
    currency: EnabledCurrency;
    index: number;
  }) {
    const code = currency.code;
    const hasBalance = nonZeroCurrencies.has(code);
    const removeDisabled = loading !== null || hasBalance || isLastEnabled;
    const orderDisabled = loading !== null;
    const effectiveSym = getEffectiveSymbol(code, enabledCurrencies);
    const netAssets = netAssetsByCurrency[code] ?? 0;
    const amountLabel = formatAmount(netAssets, code, effectiveSym);
    const tooltipLabel = hasBalance
      ? disabledReasonBalance
      : isLastEnabled
        ? disabledReasonLast
        : null;

    return (
      <Group key={code} justify="space-between" gap="xs" wrap="nowrap">
        <Group gap={8} wrap="nowrap" style={{ minWidth: 0 }}>
          <Group gap={2} wrap="nowrap">
            <ActionIcon
              size="sm"
              variant="subtle"
              disabled={orderDisabled || index === 0}
              onClick={() => void moveCurrency(index, -1)}
              aria-label={`Move ${code} up`}
            >
              <IconArrowUp size={14} />
            </ActionIcon>
            <ActionIcon
              size="sm"
              variant="subtle"
              disabled={orderDisabled || index === enabledCurrencies.length - 1}
              onClick={() => void moveCurrency(index, 1)}
              aria-label={`Move ${code} down`}
            >
              <IconArrowDown size={14} />
            </ActionIcon>
          </Group>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 22,
              height: 22,
              flexShrink: 0,
            }}
          >
            {getCurrencyIcon(code)}
          </span>
          <Text span fw={700} size="sm" style={{ width: 42 }}>
            {code}
          </Text>
          <Code
            fz="xs"
            style={{ minWidth: 68, textAlign: "right", flexShrink: 0 }}
          >
            {amountLabel}
          </Code>
          <Text size="sm" c="dimmed" truncate style={{ minWidth: 0 }}>
            {getCurrencyLabel(code)}
          </Text>
        </Group>
        <Tooltip
          label={tooltipLabel ?? ""}
          disabled={!tooltipLabel}
          withArrow
          withinPortal
        >
          <ActionIcon
            size="sm"
            variant="subtle"
            color="red"
            disabled={removeDisabled}
            onClick={() => void toggle(code, false)}
            aria-label={`Remove ${code}`}
          >
            <IconTrash size={14} />
          </ActionIcon>
        </Tooltip>
      </Group>
    );
  }

  function CurrencyCheckbox(_: {
    code: string;
    label: string;
    icon: React.ReactNode;
  }) {
    return null;
  }

  return (
    <Stack gap="md" maw={640}>
      {!initialSetup && (
        <Group gap="xs">
          <Anchor component={Link} to="/settings" size="sm">
            {t("settingsSubpageBack")}
          </Anchor>
        </Group>
      )}

      <Title order={3}>
        {initialSetup
          ? locale === "ja"
            ? "\u901a\u8ca8\u306e\u521d\u671f\u8a2d\u5b9a"
            : "Initial Currency Setup"
          : t("currencySettingsTitle")}
      </Title>

      {(initialSetup || enabledCurrencies.length === 0) && (
        <Alert
          icon={<IconInfoCircle size={16} />}
          color="orange"
          variant="light"
        >
          <Text size="sm" fw={600}>
            {locale === "ja"
              ? "\u4f7f\u7528\u3059\u308b\u901a\u8ca8\u30921\u3064\u4ee5\u4e0a\u9078\u629e\u3057\u3066\u304f\u3060\u3055\u3044"
              : "Please select at least one currency to use"}
          </Text>
          <Text size="sm" mt={4}>
            {locale === "ja"
              ? "\u6cd5\u5b9a\u901a\u8ca8\u307e\u305f\u306f\u4eee\u60f3\u901a\u8ca8\u304b\u3089\u6700\u4f4e1\u3064\u6709\u52b9\u306b\u3059\u308b\u5fc5\u8981\u304c\u3042\u308a\u307e\u3059\u3002"
              : "At least one fiat or crypto currency must be enabled."}
          </Text>
        </Alert>
      )}

      <Alert icon={<IconInfoCircle size={16} />} color="blue" variant="light">
        <Text size="sm">{t("currencySettingsNote")}</Text>
        <Text size="sm" mt={4}>
          {t("currencySettingsRateNote")}
        </Text>
      </Alert>

      <Paper withBorder p="sm" radius="sm">
        <Group justify="space-between" gap="sm" wrap="wrap">
          <Stack gap={2}>
            <Text fw={600} size="sm">
              {locale === "ja" ? "仮想通貨アイコン" : "Crypto icons"}
            </Text>
            <Group gap={6} wrap="nowrap">
              <CryptoCurrencyIcon
                code="BTC"
                styleMode={cryptoIconStyle}
                size={22}
              />
              <CryptoCurrencyIcon
                code="ETH"
                styleMode={cryptoIconStyle}
                size={22}
              />
              <CryptoCurrencyIcon
                code="SOL"
                styleMode={cryptoIconStyle}
                size={22}
              />
            </Group>
          </Stack>
          <SegmentedControl
            size="xs"
            value={cryptoIconStyle}
            onChange={(value) =>
              setCryptoIconStyle(value as CryptoIconStyle)
            }
            data={[
              {
                value: "rich",
                label: locale === "ja" ? "リッチ画像風" : "Rich",
              },
              {
                value: "symbol",
                label: locale === "ja" ? "白い記号" : "White symbol",
              },
            ]}
          />
        </Group>
      </Paper>

      {/* ── Symbol conflicts ── */}
      {symbolConflicts.length > 0 && (
        <Paper withBorder p="sm" radius="sm">
          <Stack gap="xs">
            <Group gap={6}>
              <Badge color="orange" size="sm">
                {locale === "ja" ? "記号の競合" : "Symbol conflicts"}
              </Badge>
              <Text size="xs" c="dimmed">
                {locale === "ja"
                  ? "同じ記号を使う通貨が複数有効です。金額表示で優先する通貨を選んでください。"
                  : "Multiple enabled currencies share the same symbol. Choose which one displays it."}
              </Text>
            </Group>
            {symbolConflicts.map(({ symbol, list }) => (
              <Group key={symbol} gap="sm" align="center" wrap="nowrap">
                <Code fz="sm" style={{ minWidth: 36, textAlign: "center" }}>
                  {symbol}
                </Code>
                <SegmentedControl
                  size="xs"
                  value={getPrimary(list)}
                  onChange={(code) => void setPrimary(symbol, code)}
                  data={list.map((c) => ({ value: c.code, label: c.code }))}
                />
              </Group>
            ))}
          </Stack>
        </Paper>
      )}

      {/* ── Fiat currencies ── */}
      <Paper withBorder p="sm" radius="sm">
        <Stack gap="xs">
          <Group justify="space-between" align="center" wrap="wrap" gap="xs">
            <Text fw={600} size="sm">
              {locale === "ja" ? "レート取得状況" : "Rate status"}
            </Text>
            <Group gap={6} wrap="wrap">
              <Badge variant="light" color="blue">
                {locale === "ja" ? "基準" : "Base"}{" "}
                {displayCurrency || enabledCurrencies[0]?.code || "JPY"}
              </Badge>
              <Badge
                variant="light"
                color={ratesCooldown > 0 ? "gray" : "teal"}
              >
                FX {ratesCooldown > 0 ? `${ratesCooldown}s` : "ready"}
              </Badge>
              <Badge
                variant="light"
                color={pricesCooldown > 0 ? "gray" : "teal"}
              >
                Crypto {pricesCooldown > 0 ? `${pricesCooldown}s` : "ready"}
              </Badge>
            </Group>
          </Group>
          <Text size="xs" c="dimmed">
            {locale === "ja"
              ? "法定通貨は基準通貨からの換算、暗号資産は 1 単位あたりの基準通貨価格で表示します。"
              : "Fiat currencies are quoted from the base currency; crypto is shown as the base-currency price per 1 unit."}
          </Text>
          <Stack gap={4}>
            {rateStatusRows.map((row) => (
              <Group
                key={row.code}
                justify="space-between"
                gap="xs"
                wrap="nowrap"
              >
                <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
                  <Badge
                    size="sm"
                    variant="light"
                    color={row.hasRate ? "teal" : "gray"}
                  >
                    {row.hasRate
                      ? locale === "ja"
                        ? "取得済み"
                        : "Fetched"
                      : locale === "ja"
                        ? "未取得"
                        : "Missing"}
                  </Badge>
                  <Text size="sm" fw={600} style={{ width: 42 }}>
                    {row.code}
                  </Text>
                  {row.isCrypto && (
                    <Badge size="xs" variant="outline" color="orange">
                      crypto
                    </Badge>
                  )}
                  {row.isCustom && (
                    <Badge size="xs" variant="outline" color="grape">
                      manual
                    </Badge>
                  )}
                </Group>
                <Text
                  size="sm"
                  ff="monospace"
                  ta="right"
                  truncate
                  style={{ minWidth: 0 }}
                >
                  {renderRateQuote(row.quote)}
                </Text>
              </Group>
            ))}
          </Stack>
        </Stack>
      </Paper>

      {customEnabled.length > 0 && (
        <Paper withBorder p="sm" radius="sm">
          <Stack gap="xs">
            <Group justify="space-between" align="center" wrap="wrap" gap="xs">
              <Text fw={600} size="sm">
                {locale === "ja" ? "カスタム通貨レート" : "Custom currency rates"}
              </Text>
              <Badge variant="light" color="grape">
                {locale === "ja" ? "手動" : "Manual"}
              </Badge>
            </Group>
            <Text size="xs" c="dimmed">
              {locale === "ja"
                ? "自動取得できない通貨は、1単位あたりのJPYレートを入力してください。"
                : "Enter the JPY value of 1 unit for currencies that cannot be fetched automatically."}
            </Text>
            <Stack gap={6}>
              {customEnabled.map((currency) => {
                const code = currency.code;
                const input = manualRateInputs[code] ?? "";
                const numericInput = Number(input);
                const canSave = Number.isFinite(numericInput) && numericInput > 0;
                const savedRate = manualExchangeRates[code] ?? 0;

                return (
                  <Group key={code} gap="xs" align="flex-end" wrap="nowrap">
                    <Group gap={6} wrap="nowrap" style={{ minWidth: 88 }}>
                      <CustomCurrencyIcon icon={currency.custom_icon} />
                      <Text size="sm" fw={700}>
                        {code}
                      </Text>
                    </Group>
                    <NumberInput
                      label={`1 ${code} =`}
                      value={input}
                      onChange={(value) => updateManualRateInput(code, value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") saveManualRate(code);
                      }}
                      min={0}
                      decimalScale={8}
                      allowNegative={false}
                      clampBehavior="none"
                      rightSection={<Text size="xs">JPY</Text>}
                      rightSectionWidth={42}
                      w={180}
                    />
                    <ActionIcon
                      variant="filled"
                      onClick={() => saveManualRate(code)}
                      disabled={!canSave}
                      mb={1}
                      aria-label={`Save ${code} manual rate`}
                    >
                      <IconCheck size={16} />
                    </ActionIcon>
                    <ActionIcon
                      variant="subtle"
                      color="gray"
                      onClick={() => clearManualRate(code)}
                      disabled={savedRate <= 0 && input === ""}
                      mb={1}
                      aria-label={`Clear ${code} manual rate`}
                    >
                      <IconX size={16} />
                    </ActionIcon>
                  </Group>
                );
              })}
            </Stack>
          </Stack>
        </Paper>
      )}

      <Divider />

      <Stack gap="xs">
        <Text fw={600} size="sm">
          {locale === "ja" ? "有効な通貨" : "Enabled currencies"}
        </Text>
        <Paper withBorder p="sm" radius="sm">
          <Stack gap="xs">
            {enabledCurrencies.map((currency, index) => (
              <CurrencyListRow
                key={currency.code}
                currency={currency}
                index={index}
              />
            ))}
          </Stack>
        </Paper>
      </Stack>

      <Stack gap="xs">
        <Text fw={600} size="sm">
          {locale === "ja" ? "通貨を追加" : "Add currency"}
        </Text>
        <Group gap="xs" align="flex-end">
          <Select
            label={locale === "ja" ? "既知の通貨" : "Known currency"}
            placeholder={locale === "ja" ? "通貨を選択" : "Select currency"}
            value={selectedKnownCode}
            onChange={setSelectedKnownCode}
            data={knownCurrencyOptions}
            leftSection={
              selectedKnownCode ? getCurrencyIcon(selectedKnownCode) : undefined
            }
            renderOption={({ option }) => (
              <Group gap={8} wrap="nowrap">
                {getCurrencyIcon(option.value)}
                <Text size="sm">{option.label}</Text>
              </Group>
            )}
            searchable
            clearable
            w={300}
          />
          <ActionIcon
            variant="filled"
            onClick={() => void addKnownCurrency()}
            disabled={!selectedKnownCode || loading !== null}
            mb={1}
          >
            <IconPlus size={16} />
          </ActionIcon>
        </Group>
      </Stack>

      <Divider />

      {false && (
        <>
          <Stack gap="xs">
            <Text fw={600} size="sm">
              {t("currencySettingsFiatGroup")}
            </Text>
            {FIAT_CURRENCIES.map((c) => (
              <CurrencyCheckbox
                key={c.code}
                code={c.code}
                icon={<FlagIcon code={c.code} />}
                label={locale === "ja" ? `${c.nameJa} / ${c.name}` : c.name}
              />
            ))}
          </Stack>

          <Divider />

          {/* ── Crypto currencies ── */}
          <Stack gap="xs">
            <Text fw={600} size="sm">
              {t("currencySettingsCryptoGroup")}
            </Text>
            {CRYPTO_CURRENCIES.map((c) => (
              <CurrencyCheckbox
                key={c.code}
                code={c.code}
                icon={<CryptoIcon symbol={c.icon} />}
                label={locale === "ja" ? `${c.nameJa} / ${c.name}` : c.name}
              />
            ))}
          </Stack>

          {/* ── Custom currencies ── */}
          {customEnabled.length > 0 && (
            <>
              <Divider />
              <Stack gap="xs">
                <Text fw={600} size="sm">
                  {locale === "ja" ? "カスタム通貨" : "Custom Currencies"}
                </Text>
                {customEnabled.map((c) => (
                  <CurrencyCheckbox
                    key={c.code}
                    code={c.code}
                    icon={<CustomCurrencyIcon icon={c.custom_icon} />}
                    label={`${c.code} (${resolveCustomCurrencySymbol(c.custom_symbol, c.custom_icon)})`}
                  />
                ))}
              </Stack>
            </>
          )}
        </>
      )}

      <Divider />

      {/* ── Add custom currency ── */}
      <Stack gap="xs">
        <Text fw={600} size="sm">
          {locale === "ja" ? "カスタム通貨を追加" : "Add Custom Currency"}
        </Text>
        <Group gap="xs" align="flex-end">
          <TextInput
            label={locale === "ja" ? "通貨コード" : "Code"}
            placeholder="e.g. VND"
            value={customCode}
            onChange={(e) => setCustomCode(e.currentTarget.value.toUpperCase())}
            onKeyDown={(e) => {
              if (e.key === "Enter") void addCustom();
            }}
            maxLength={10}
            w={110}
          />
          <Select
            label={locale === "ja" ? "表示アイコン" : "Display icon"}
            placeholder={
              locale === "ja" ? "アイコンを選択" : "Select an icon"
            }
            value={customIcon}
            onChange={(value) =>
              setCustomIcon(
                isCustomCurrencyIconOption(value)
                  ? value
                  : DEFAULT_CUSTOM_CURRENCY_ICON,
              )
            }
            data={customCurrencyIconOptions}
            leftSection={<CustomCurrencyIcon icon={customIcon} />}
            renderOption={({ option }) => (
              <Group gap={8} wrap="nowrap">
                <CustomCurrencyIcon icon={option.value} />
                <Text size="sm">{option.label}</Text>
              </Group>
            )}
            searchable
            allowDeselect={false}
            limit={8}
            maxDropdownHeight={260}
            w={190}
          />
          <TextInput
            label={locale === "ja" ? "通貨記号" : "Currency symbol"}
            placeholder={fallbackSymbolForCustomCurrencyIcon(customIcon)}
            value={customSymbol}
            onChange={(e) => setCustomSymbol(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void addCustom();
            }}
            maxLength={8}
            w={120}
          />
          <NumberInput
            label={locale === "ja" ? "小数桁数" : "Decimal places"}
            value={customDecimalPlaces}
            onChange={setCustomDecimalPlaces}
            min={0}
            max={9}
            step={1}
            allowDecimal={false}
            clampBehavior="strict"
            w={120}
          />
          <ActionIcon
            variant="filled"
            onClick={() => void addCustom()}
            disabled={
              !customCode.trim() ||
              enabledSet.has(customCode.trim().toUpperCase()) ||
              !Number.isInteger(Number(customDecimalPlaces)) ||
              Number(customDecimalPlaces) < 0 ||
              Number(customDecimalPlaces) > 9
            }
            mb={1}
          >
            <IconPlus size={16} />
          </ActionIcon>
        </Group>
      </Stack>

      <Divider />

      {/* ── API source selection ── */}
      <Stack gap="xs">
        <Text fw={600} size="sm">
          {t("currencySettingsApiSourceTitle")}
        </Text>
        {providerMsg && (
          <Alert color="teal" variant="light" p="xs">
            <Text size="sm">{providerMsg}</Text>
          </Alert>
        )}
        <Select
          label={t("currencySettingsFiatApiLabel")}
          value={fiatProvider}
          onChange={(v) => void handleFiatProviderChange(v)}
          data={[
            {
              value: "frankfurter",
              label: "Frankfurter (frankfurter.app)",
            },
            {
              value: "er_api",
              label: "ExchangeRate-API (open.er-api.com)",
            },
          ]}
          w={300}
        />
        <Select
          label={t("currencySettingsCryptoApiLabel")}
          value={cryptoProvider}
          onChange={(v) => void handleCryptoProviderChange(v)}
          data={[
            {
              value: "coingecko",
              label: "CoinGecko (coingecko.com)",
            },
            {
              value: "coinpaprika",
              label: "CoinPaprika (coinpaprika.com)",
            },
          ]}
          w={300}
        />
      </Stack>
    </Stack>
  );
}
