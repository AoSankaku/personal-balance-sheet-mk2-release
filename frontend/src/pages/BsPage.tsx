import {
  Anchor,
  Group,
  Paper,
  SimpleGrid,
  Skeleton,
  Stack,
  Text,
} from "@mantine/core";
import { DatePickerInput } from "@mantine/dates";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { Account } from "@balance-sheet/shared";
import { api } from "../api/client";
import { useLang } from "../i18n";
import { useAppData } from "../context/AppDataContext";
import { AccountTable } from "../components/AccountTable";
import { BsHistoryChart } from "../components/BsHistoryChart";
import { AppDataErrorAlert } from "../components/AppDataErrorAlert";
import { formatCurrency } from "../lib/numberFormat";

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
  } = useAppData();

  const fmt = (amount: number) =>
    formatCurrency(
      convertCurrency(amount, "JPY", displayCurrency),
      locale,
      displayCurrency,
      displayCurrencySymbol,
    );
  const fmtBalance = (amount: number | null | undefined) =>
    amount == null
      ? "—"
      : formatCurrency(
          convertCurrency(amount, "JPY", displayCurrency),
          locale,
          displayCurrency,
          displayCurrencySymbol,
        );

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
    const dateStr = asOf.toISOString().slice(0, 10);
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
            ? (cryptoValueMap.get(a.id) ?? 0)
            : Object.entries(a.balances ?? {}).reduce(
                (sum, [cur, amt]) => sum + convertCurrency(amt, cur, "JPY"),
                0,
              ),
      })),
    [assets, cryptoValueMap, asOf, convertCurrency],
  );

  const depreciableAssetsDisplay = useMemo(
    () =>
      depreciableAssets.map((a) => ({
        ...a,
        balance: Object.entries(a.balances ?? {}).reduce(
          (sum, [cur, amt]) => sum + convertCurrency(amt, cur, "JPY"),
          0,
        ),
      })),
    [depreciableAssets, convertCurrency],
  );

  const totalDepreciableAssets = depreciableAssetsDisplay.reduce(
    (s, a) => s + (a.balance ?? 0),
    0,
  );

  const totalAssets =
    assetsDisplay.reduce((s, a) => s + (a.balance ?? 0), 0) +
    totalDepreciableAssets;
  const totalLiabilities = liabilities.reduce(
    (s, a) =>
      s +
      Object.entries(a.balances ?? {}).reduce(
        (sum, [cur, amt]) => sum + convertCurrency(amt, cur, "JPY"),
        0,
      ),
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

      <BsHistoryChart journal={journal} accounts={currentAccounts} />

      <Group justify="flex-end">
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
              <Text size="xs" tt="uppercase" fw={700} c="dimmed">
                {t("assets")}
              </Text>
              <Text size="lg" fw={700} c="teal">
                {fmt(totalAssets)}
              </Text>
            </Paper>
            <Paper withBorder p="md" radius="md">
              <Text size="xs" tt="uppercase" fw={700} c="dimmed">
                {t("liabilities")}
              </Text>
              <Text size="lg" fw={700} c="red">
                {fmt(totalLiabilities)}
              </Text>
            </Paper>
            <Paper withBorder p="md" radius="md">
              <Text size="xs" tt="uppercase" fw={700} c="dimmed">
                {t("netWorth")}
              </Text>
              <Text size="lg" fw={700} c={netWorth >= 0 ? "blue" : "red"}>
                {fmt(netWorth)}
              </Text>
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
              accounts={liabilities}
              formatBalance={fmtBalance}
            />
          )}
          {equity.length > 0 && (
            <AccountTable
              title={t("sectionEquity")}
              accounts={equity}
              formatBalance={fmtBalance}
            />
          )}
        </>
      )}
    </Stack>
  );
}
