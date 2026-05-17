import {
  Anchor,
  Badge,
  Group,
  Paper,
  SimpleGrid,
  Skeleton,
  Stack,
  Switch,
  Text,
} from "@mantine/core";
import { DatePickerInput } from "@mantine/dates";
import { IconInfoCircle } from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { Account } from "@balance-sheet/shared";
import { api } from "../api/client";
import { useLang } from "../i18n";
import { useAppData } from "../context/AppDataContext";
import { AccountTable } from "../components/AccountTable";
import { BsHistoryChart } from "../components/BsHistoryChart";
import { AppDataErrorAlert } from "../components/AppDataErrorAlert";
import { BalanceDisplay } from "../components/BalanceDisplay";
import { formatCurrency } from "../lib/numberFormat";
import { balanceMapAmountForDisplayMode } from "../lib/displayCurrencyAmounts";

export default function BsPage() {
  const { t, locale } = useLang();
  const {
    accounts: currentAccounts,
    journal,
    cryptoValueMap,
    loading,
    error,
    displayCurrency,
    displayCurrencySymbol,
    convertCurrency,
    enabledCurrencies,
  } = useAppData();
  const [includeAllCurrencies, setIncludeAllCurrencies] = useState(false);
  const hasMultipleCurrencies = enabledCurrencies.length > 1;
  const selectedCurrencyBadgeLabel =
    locale === "ja" ? `${displayCurrency}のみ` : `${displayCurrency} only`;

  const fmtBalance = (amount: number | null | undefined) =>
    amount == null
      ? "—"
      : formatCurrency(
          amount,
          locale,
          displayCurrency,
          displayCurrencySymbol,
        );
  const balanceInDisplayCurrency = (balances?: Record<string, number>) =>
    balanceMapAmountForDisplayMode(
      balances,
      displayCurrency,
      convertCurrency,
      includeAllCurrencies,
    );
  const liveCryptoValueInDisplayCurrency = (valueJpy: number) =>
    includeAllCurrencies || displayCurrency === "JPY"
      ? convertCurrency(valueJpy, "JPY", displayCurrency)
      : 0;

  const [asOf, setAsOf] = useState<Date | null>(null);
  const [historicalAccounts, setHistoricalAccounts] = useState<
    Account[] | null
  >(null);
  const [historicalLoading, setHistoricalLoading] = useState(false);

  useEffect(() => {
    if (!asOf) {
      setHistoricalAccounts(null);
      return;
    }
    const dateStr = `${asOf.getFullYear()}-${String(asOf.getMonth() + 1).padStart(2, "0")}-${String(asOf.getDate()).padStart(2, "0")}`;
    setHistoricalLoading(true);
    api.accounts
      .list(dateStr)
      .then((rows) => setHistoricalAccounts(rows))
      .catch(() => setHistoricalAccounts(null))
      .finally(() => setHistoricalLoading(false));
  }, [asOf]);

  const accounts = historicalAccounts ?? currentAccounts;

  // Exclude the 不明金 system account and explicitly separate depreciable assets (固定資産).
  const assets = useMemo(
    () =>
      accounts.filter(
        (a) =>
          a.type === "asset" &&
          !a.is_depreciable &&
          a.name !== "__system:unknown_funds__",
      ),
    [accounts],
  );

  const depreciableAssets = useMemo(
    () => accounts.filter((a) => a.type === "asset" && a.is_depreciable),
    [accounts],
  );
  const liabilities = useMemo(
    () => accounts.filter((a) => a.type === "liability"),
    [accounts],
  );
  const equity = useMemo(
    () => accounts.filter((a) => a.type === "equity"),
    [accounts],
  );

  // Apply live crypto values for current (non-historical) view
  const assetsDisplay = useMemo(
    () =>
      assets.map((a) => ({
        ...a,
        balance:
          !asOf && cryptoValueMap.has(a.id)
            ? liveCryptoValueInDisplayCurrency(cryptoValueMap.get(a.id) ?? 0)
            : balanceInDisplayCurrency(a.balances),
      })),
    [
      assets,
      cryptoValueMap,
      asOf,
      displayCurrency,
      convertCurrency,
      includeAllCurrencies,
    ],
  );

  const depreciableAssetsDisplay = useMemo(
    () =>
      depreciableAssets.map((a) => ({
        ...a,
        balance: balanceInDisplayCurrency(a.balances),
      })),
    [depreciableAssets, displayCurrency, convertCurrency, includeAllCurrencies],
  );

  const liabilitiesDisplay = useMemo(
    () =>
      liabilities.map((a) => ({
        ...a,
        balance: balanceInDisplayCurrency(a.balances),
      })),
    [liabilities, displayCurrency, convertCurrency, includeAllCurrencies],
  );

  const equityDisplay = useMemo(
    () =>
      equity.map((a) => ({
        ...a,
        balance: balanceInDisplayCurrency(a.balances),
      })),
    [equity, displayCurrency, convertCurrency, includeAllCurrencies],
  );

  const totalDepreciableAssets = depreciableAssetsDisplay.reduce(
    (s, a) => s + (a.balance ?? 0),
    0,
  );

  const totalAssets =
    assetsDisplay.reduce((s, a) => s + (a.balance ?? 0), 0) +
    totalDepreciableAssets;
  const totalLiabilities = liabilitiesDisplay.reduce(
    (s, a) => s + (a.balance ?? 0),
    0,
  );
  const netWorth = totalAssets - totalLiabilities;

  if (loading) {
    return (
      <Stack gap="lg">
        <Skeleton height={22} width={100} radius="sm" />
        <Skeleton height={36} width={180} radius="sm" />
        <SimpleGrid cols={{ base: 1, sm: 3 }}>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} height={80} radius="md" />
          ))}
        </SimpleGrid>
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} height={120} radius="md" />
        ))}
      </Stack>
    );
  }

  if (error) {
    return <AppDataErrorAlert error={error} />;
  }

  return (
    <Stack gap="lg">
      <Anchor component={Link} to="/fs" size="sm" c="dimmed">
        ← {t("navFS")}
      </Anchor>

      <BsHistoryChart
        journal={journal}
        accounts={currentAccounts}
        includeAllCurrencies={includeAllCurrencies}
      />

      <Group justify="space-between" align="flex-end">
        {hasMultipleCurrencies ? (
          <Switch
            size="sm"
            label={
              locale === "ja"
                ? "すべての通貨を含める"
                : "Include all currencies"
            }
            checked={includeAllCurrencies}
            onChange={(event) =>
              setIncludeAllCurrencies(event.currentTarget.checked)
            }
          />
        ) : (
          <span />
        )}
        <DatePickerInput
          label={t("asOfDate")}
          placeholder={locale === "ja" ? "空欄で現在残高" : "Blank for current"}
          value={asOf}
          onChange={setAsOf}
          clearable
          size="sm"
          w={180}
          valueFormat="YYYY-MM-DD"
        />
      </Group>

      {historicalLoading ? (
        <Stack gap="sm">
          <SimpleGrid cols={{ base: 1, sm: 3 }}>
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} height={80} radius="md" />
            ))}
          </SimpleGrid>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} height={120} radius="md" />
          ))}
        </Stack>
      ) : (
        <>
          <SimpleGrid cols={{ base: 1, sm: 3 }}>
            <Paper withBorder p="md" radius="md">
              <Group gap={6} align="center">
                <Text size="xs" tt="uppercase" fw={700} c="dimmed">
                  {t("assets")}
                </Text>
                {hasMultipleCurrencies && !includeAllCurrencies && (
                  <Badge
                    size="xs"
                    variant="light"
                    color="teal"
                    leftSection={<IconInfoCircle size={12} />}
                  >
                    {selectedCurrencyBadgeLabel}
                  </Badge>
                )}
              </Group>
              <BalanceDisplay
                amount={totalAssets}
                currency={displayCurrency}
                displaySymbol={displayCurrencySymbol}
                fw={700}
                c="teal"
                size="lg"
              />
            </Paper>
            <Paper withBorder p="md" radius="md">
              <Group gap={6} align="center">
                <Text size="xs" tt="uppercase" fw={700} c="dimmed">
                  {t("liabilities")}
                </Text>
                {hasMultipleCurrencies && !includeAllCurrencies && (
                  <Badge
                    size="xs"
                    variant="light"
                    color="red"
                    leftSection={<IconInfoCircle size={12} />}
                  >
                    {selectedCurrencyBadgeLabel}
                  </Badge>
                )}
              </Group>
              <BalanceDisplay
                amount={totalLiabilities}
                currency={displayCurrency}
                displaySymbol={displayCurrencySymbol}
                fw={700}
                c="red"
                size="lg"
              />
            </Paper>
            <Paper withBorder p="md" radius="md">
              <Group gap={6} align="center">
                <Text size="xs" tt="uppercase" fw={700} c="dimmed">
                  {t("netWorth")}
                </Text>
                {hasMultipleCurrencies && !includeAllCurrencies && (
                  <Badge
                    size="xs"
                    variant="light"
                    color="blue"
                    leftSection={<IconInfoCircle size={12} />}
                  >
                    {selectedCurrencyBadgeLabel}
                  </Badge>
                )}
              </Group>
              <BalanceDisplay
                amount={netWorth}
                currency={displayCurrency}
                displaySymbol={displayCurrencySymbol}
                fw={700}
                c={netWorth >= 0 ? "blue" : "red"}
                size="lg"
              />
            </Paper>
          </SimpleGrid>
          {assets.length > 0 && (
            <AccountTable
              title={t("sectionAssets")}
              accounts={assetsDisplay}
              formatBalance={fmtBalance}
            />
          )}
          {depreciableAssets.length > 0 && (
            <AccountTable
              title={t("sectionDepreciableAssets")}
              accounts={depreciableAssetsDisplay}
              formatBalance={fmtBalance}
            />
          )}
          {liabilities.length > 0 && (
            <AccountTable
              title={t("sectionLiabilities")}
              accounts={liabilitiesDisplay}
              formatBalance={fmtBalance}
            />
          )}
          {equity.length > 0 && (
            <AccountTable
              title={t("sectionEquity")}
              accounts={equityDisplay}
              formatBalance={fmtBalance}
            />
          )}
        </>
      )}
    </Stack>
  );
}
