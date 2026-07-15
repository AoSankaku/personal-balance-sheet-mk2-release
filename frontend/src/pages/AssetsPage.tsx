import {
  Accordion,
  Badge,
  Box,
  Button,
  ColorSwatch,
  Divider,
  Grid,
  Group,
  Paper,
  Progress,
  SimpleGrid,
  Skeleton,
  Stack,
  Switch,
  Text,
  ThemeIcon,
  rem,
} from "@mantine/core";
import { DonutChart } from "@mantine/charts";
import {
  IconActivity,
  IconBuildingBank,
  IconCoin,
  IconCreditCard,
  IconCurrencyBitcoin,
  IconFileAnalytics,
  IconHandStop,
  IconInfoCircle,
  IconPigMoney,
  IconReportMoney,
  IconScale,
  IconTrendingDown,
  IconTrendingUp,
} from "@tabler/icons-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  isShortTermLendingCategory,
  isShortTermBorrowingCategory,
  isLongTermLendingCategory,
  isLongTermBorrowingCategory,
  isBusinessAdvanceCategory,
} from "@balance-sheet/shared";
import { useLang } from "../i18n";
import { useAppData } from "../context/AppDataContext";
import { NetWorthChart } from "../components/NetWorthChart";
import { ExpenseBarChart } from "../components/ExpenseBarChart";
import { AppDataErrorAlert } from "../components/AppDataErrorAlert";
import { BalanceDisplay } from "../components/BalanceDisplay";
import { formatCurrency } from "../lib/numberFormat";
import {
  balanceMapAmountForDisplayMode,
  lineAmountForDisplayMode,
} from "../lib/displayCurrencyAmounts";
import { toDateStr } from "../lib/dateUtils";
import {
  isShortTermLoanAccountActive,
  isUnsettledOpeningEntry,
} from "./dbPageUtils";
import { privateIndexedLabel, privacyChartAmount } from "../lib/privacy";
import { usePrivacy } from "../context/PrivacyContext";
import { getAssetCompositionBar } from "../lib/assetCompositionBar";

// Distinct colors cycling through account items in the donut
const DONUT_COLORS = [
  "teal.6",
  "blue.5",
  "cyan.6",
  "indigo.5",
  "violet.5",
  "grape.5",
  "green.6",
  "lime.5",
  "yellow.5",
  "orange.5",
];

export default function AssetsPage() {
  const { t, locale } = useLang();
  const { privacyMode, maskAccountNames } = usePrivacy();
  const {
    accounts,
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
  const maskFinancialLabels = privacyMode && maskAccountNames;
  const selectedCurrencyBadgeLabel =
    locale === "ja" ? `${displayCurrency}のみ` : `${displayCurrency} only`;

  const fmt = (amount: number) =>
    formatCurrency(
      amount,
      locale,
      displayCurrency,
      displayCurrencySymbol,
    );
  const assetBreakdownLabel = (labelKey: Parameters<typeof t>[0], index: number) =>
    maskFinancialLabels ? privateIndexedLabel(t("typeAsset"), index) : t(labelKey);
  const liabilityBreakdownLabel = (
    labelKey: Parameters<typeof t>[0],
    index: number,
  ) =>
    maskFinancialLabels
      ? privateIndexedLabel(t("typeLiability"), index)
      : t(labelKey);
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

  // Exclude the 不明金 system account and depreciable assets from regular asset computations.
  // Depreciable assets are shown as a separate section (固定資産).
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

  // Total incomplete loan count — mirrors DbPage's definition:
  // short-term: unsettled opening entries for each active account
  // long-term: non-completed accounts
  const unresolvedShortTermCount = useMemo(() => {
    const shortTermAccounts = accounts.filter(
      (a) =>
        isShortTermLendingCategory(a.category as never) ||
        isShortTermBorrowingCategory(a.category as never),
    );
    const longTermAccounts = accounts.filter(
      (a) =>
        isLongTermLendingCategory(a.category as never) ||
        isLongTermBorrowingCategory(a.category as never),
    );

    let count = 0;

    for (const acct of shortTermAccounts) {
      const entries = journal
        .filter((e) => e.lines.some((l) => l.account_id === acct.id))
        .map((e) => {
          let netChange = 0;
          for (const l of e.lines) {
            if (l.account_id !== acct.id) continue;
            if (acct.type === "asset" || acct.type === "expense") {
              netChange += l.debit - l.credit;
            } else {
              netChange += l.credit - l.debit;
            }
          }
          return { entry: e, netChange };
        });
      if (!isShortTermLoanAccountActive(acct, entries)) continue;
      count += entries.filter(isUnsettledOpeningEntry).length;
    }

    count += longTermAccounts.filter((a) => !a.is_completed).length;

    return count;
  }, [accounts, journal]);

  const assetsWithEffectiveBalance = useMemo(
    () =>
      assets.map((a) => ({
        ...a,
        balance: cryptoValueMap.has(a.id)
          ? liveCryptoValueInDisplayCurrency(cryptoValueMap.get(a.id) ?? 0)
          : balanceInDisplayCurrency(a.balances),
      })),
    [assets, cryptoValueMap, displayCurrency, convertCurrency, includeAllCurrencies],
  );

  const depreciableAssetsTotal = useMemo(
    () =>
      depreciableAssets.reduce(
        (s, a) => s + balanceInDisplayCurrency(a.balances),
        0,
      ),
    [depreciableAssets, displayCurrency, convertCurrency, includeAllCurrencies],
  );

  const totalAssets = assetsWithEffectiveBalance.reduce(
    (s, a) => s + (a.balance ?? 0),
    0,
  );
  const totalLiabilities = liabilities.reduce(
    (s, a) => s + balanceInDisplayCurrency(a.balances),
    0,
  );

  // Asset breakdown by category (ordered; all non-"other" categories get their own row)
  const assetCategories = useMemo(() => {
    const ORDER = [
      { key: "cash", labelKey: "catCash" },
      { key: "short_term_lending", labelKey: "catShortTermLending" },
      { key: "long_term_lending", labelKey: "catLongTermLending" },
      { key: "business_advance", labelKey: "catBusinessAdvance" },
      { key: "investment", labelKey: "catInvestment" },
      { key: "crypto", labelKey: "catCrypto" },
      { key: "property", labelKey: "catProperty" },
      { key: "other", labelKey: "catOther" },
    ];
    const totals: Record<string, number> = {};
    for (const a of assetsWithEffectiveBalance) {
      const bal = a.balance ?? 0;
      let key: string;
      if (isShortTermLendingCategory(a.category)) key = "short_term_lending";
      else if (isLongTermLendingCategory(a.category)) key = "long_term_lending";
      else if (isBusinessAdvanceCategory(a.category)) key = "business_advance";
      else if (
        a.category === "cash" ||
        a.category === "investment" ||
        a.category === "property" ||
        a.category === "crypto"
      )
        key = a.category;
      else key = "other";
      totals[key] = (totals[key] ?? 0) + bal;
    }
    return ORDER.filter((c) => (totals[c.key] ?? 0) !== 0).map((c) => ({
      ...c,
      total: totals[c.key] ?? 0,
    }));
  }, [assetsWithEffectiveBalance]);

  // Liability breakdown by category (ordered)
  const liabilityCategories = useMemo(() => {
    const ORDER = [
      { key: "credit_card", labelKey: "catCreditCard" },
      { key: "short_term_loan", labelKey: "catShortTermLoan" },
      { key: "long_term_loan", labelKey: "catLongTermLoan" },
      { key: "business_advance", labelKey: "catBusinessAdvance" },
      { key: "other", labelKey: "catOther" },
    ];
    const totals: Record<string, number> = {};
    for (const a of liabilities) {
      const bal = balanceInDisplayCurrency(a.balances);
      let key: string;
      if (a.category === "credit_card") key = "credit_card";
      else if (isShortTermBorrowingCategory(a.category))
        key = "short_term_loan";
      else if (isLongTermBorrowingCategory(a.category)) key = "long_term_loan";
      else if (isBusinessAdvanceCategory(a.category)) key = "business_advance";
      else key = "other";
      totals[key] = (totals[key] ?? 0) + bal;
    }
    return ORDER.filter((c) => (totals[c.key] ?? 0) !== 0).map((c) => ({
      ...c,
      total: totals[c.key] ?? 0,
    }));
  }, [liabilities, displayCurrency, convertCurrency, includeAllCurrencies]);
  const netWorth = totalAssets - totalLiabilities;

  // Financial Health Indicator score
  const financialHealth = useMemo(() => {
    const cashTotal = assetsWithEffectiveBalance
      .filter((a) => a.category === "cash")
      .reduce((s, a) => s + (a.balance ?? 0), 0);

    // 1. 流動性比率 (30pts): cashTotal / min(3,000,000, totalAssets) >= 50%
    const liquidityBase =
      totalAssets > 0 ? Math.min(3_000_000, totalAssets) : 0;
    const liquidityRatio = liquidityBase > 0 ? cashTotal / liquidityBase : 1;
    const liquidityScore =
      liquidityBase > 0
        ? Math.floor(Math.min(liquidityRatio / 0.5, 1) * 30)
        : 30;

    // 2. 純資産比率 (30pts): max(netWorth, 0) / totalAssets >= 60%
    const equityRatio =
      totalAssets > 0
        ? Math.max(netWorth, 0) / totalAssets
        : netWorth >= 0
          ? 1
          : 0;
    const equityScore = Math.floor(Math.min(equityRatio / 0.6, 1) * 30);

    // 3. 支出余力 (40pts): cashTotal / ((avg + median*2)/3 * 12) >= 100%
    const now = new Date();
    const currentYM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const expenseIds = new Set(
      accounts.filter((a) => a.type === "expense").map((a) => a.id),
    );
    const monthMap = new Map<string, number>();
    for (const entry of journal) {
      const ym = entry.date.slice(0, 7);
      if (ym >= currentYM) continue;
      for (const line of entry.lines) {
        if (expenseIds.has(line.account_id)) {
          const net = lineAmountForDisplayMode(
            line.debit - line.credit,
            line.currency,
            displayCurrency,
            convertCurrency,
            includeAllCurrencies,
          );
          if (net > 0) monthMap.set(ym, (monthMap.get(ym) ?? 0) + net);
        }
      }
    }
    const last6 = Array.from(monthMap.keys())
      .sort()
      .slice(-6)
      .map((m) => monthMap.get(m)!);

    let spendingScore = 40;
    let annualEstimate = 0;
    if (last6.length > 0) {
      const avg = last6.reduce((s, v) => s + v, 0) / last6.length;
      const sorted = [...last6].sort((a, b) => a - b);
      const n = sorted.length;
      const median =
        n % 2 === 0
          ? (sorted[n / 2 - 1]! + sorted[n / 2]!) / 2
          : sorted[Math.floor(n / 2)]!;
      annualEstimate = ((avg + median * 2) / 3) * 12;
      spendingScore =
        annualEstimate > 0
          ? Math.floor(Math.min(cashTotal / annualEstimate, 1) * 40)
          : 40;
    }

    const total = liquidityScore + equityScore + spendingScore;
    const rating: "safe" | "caution" | "danger" =
      total >= 92 ? "safe" : total >= 76 ? "caution" : "danger";
    const ratingColor =
      rating === "safe" ? "green" : rating === "caution" ? "yellow" : "red";

    const spendingRatio =
      annualEstimate > 0 ? cashTotal / annualEstimate : null;

    return {
      cashTotal,
      liquidityBase,
      liquidityRatio,
      liquidityScore,
      equityRatio,
      equityScore,
      annualEstimate,
      spendingRatio,
      spendingScore,
      hasSpendingData: last6.length > 0,
      total,
      rating,
      ratingColor,
    };
  }, [
    assetsWithEffectiveBalance,
    totalAssets,
    netWorth,
    accounts,
    journal,
    displayCurrency,
    convertCurrency,
    includeAllCurrencies,
  ]);

  // A balance sheet is composed as assets = liabilities + net worth.
  const assetComposition = getAssetCompositionBar(
    totalAssets,
    totalLiabilities,
  );
  const hasAssetComposition = totalAssets !== 0 || totalLiabilities !== 0;
  const percentageLabel = (value: number | null) =>
    value === null ? "—" : `${value}%`;

  // Build daily net-worth history from journal lines (one point per unique entry date).
  // Exclude future-dated entries so the chart never shows data beyond today.
  const netWorthHistory = useMemo(() => {
    if (journal.length === 0) return [];

    const todayStr = toDateStr(new Date());
    const pastJournal = journal.filter((e) => e.date.slice(0, 10) <= todayStr);
    if (pastJournal.length === 0) return [];

    const accountTypeMap = new Map<number, string>();
    const depreciableIds = new Set<number>();
    for (const a of accounts) {
      accountTypeMap.set(a.id, a.type);
      if (a.is_depreciable) depreciableIds.add(a.id);
    }

    const dateSet = new Set<string>();
    for (const entry of pastJournal) dateSet.add(entry.date.slice(0, 10));
    const dates = Array.from(dateSet).sort();
    if (dates.length < 2) return [];

    const sorted = [...pastJournal].sort((a, b) =>
      a.date.localeCompare(b.date),
    );
    const assetBal = new Map<number, number>();
    const liabBal = new Map<number, number>();
    let idx = 0;

    return dates.map((date) => {
      while (idx < sorted.length && sorted[idx]!.date.slice(0, 10) <= date) {
        for (const line of sorted[idx]!.lines) {
          if (depreciableIds.has(line.account_id)) continue;
          const type = accountTypeMap.get(line.account_id);
          if (type === "asset") {
            assetBal.set(
              line.account_id,
              (assetBal.get(line.account_id) ?? 0) +
                lineAmountForDisplayMode(
                  line.debit - line.credit,
                  line.currency,
                  displayCurrency,
                  convertCurrency,
                  includeAllCurrencies,
                ),
            );
          } else if (type === "liability") {
            liabBal.set(
              line.account_id,
              (liabBal.get(line.account_id) ?? 0) +
                lineAmountForDisplayMode(
                  line.credit - line.debit,
                  line.currency,
                  displayCurrency,
                  convertCurrency,
                  includeAllCurrencies,
                ),
            );
          }
        }
        idx++;
      }
      const assets = Array.from(assetBal.values()).reduce((s, v) => s + v, 0);
      const liabilities = Array.from(liabBal.values()).reduce(
        (s, v) => s + v,
        0,
      );
      return { date, assets, liabilities, net_worth: assets - liabilities };
    });
  }, [journal, accounts, displayCurrency, convertCurrency, includeAllCurrencies]);

  const donutData = useMemo(
    () =>
      [...assetsWithEffectiveBalance]
        .filter((a) => (a.balance ?? 0) > 0)
        .sort((a, b) => (b.balance ?? 0) - (a.balance ?? 0))
        .map((a, i) => ({
          name: a.name,
          value: privacyChartAmount(a.balance ?? 0),
          color: DONUT_COLORS[i % DONUT_COLORS.length],
        })),
    [assetsWithEffectiveBalance],
  );

  if (loading) {
    return (
      <Stack gap="lg">
        <Skeleton height={120} radius="md" />
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <Skeleton height={90} radius="md" />
          <Skeleton height={90} radius="md" />
        </SimpleGrid>
        <Grid>
          <Grid.Col span={{ base: 12, md: 8 }}>
            <Skeleton height={220} radius="md" />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 4 }}>
            <Skeleton height={220} radius="md" />
          </Grid.Col>
        </Grid>
        <SimpleGrid cols={3}>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} height={100} radius="md" />
          ))}
        </SimpleGrid>
      </Stack>
    );
  }

  if (error) {
    return <AppDataErrorAlert error={error} />;
  }

  return (
    <Stack gap="lg">
      {hasMultipleCurrencies && (
        <Group justify="flex-end">
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
        </Group>
      )}

      {/* Net Worth hero card */}
      <Paper withBorder p="xl" radius="md">
        <Group
          justify="space-between"
          align="flex-start"
          mb={hasAssetComposition ? "lg" : 0}
        >
          <Box>
            <Group gap={6} align="center" mb={6}>
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
              fw={900}
              c={netWorth >= 0 ? "blue" : "red"}
            />
          </Box>
          <ThemeIcon
            size={54}
            radius="xl"
            color={netWorth >= 0 ? "blue" : "red"}
            variant="light"
          >
            {netWorth >= 0 ? (
              <IconTrendingUp size={28} />
            ) : (
              <IconTrendingDown size={28} />
            )}
          </ThemeIcon>
        </Group>

        {/* Total assets composed of liabilities and net worth */}
        {hasAssetComposition && (
          <Box>
            <Group justify="space-between" mb={8}>
              <Group gap={6}>
                <ColorSwatch
                  color="var(--mantine-color-teal-6)"
                  size={10}
                  withShadow={false}
                />
                <Text size="xs" fw={700} c="dimmed">
                  {t("assets")} {totalAssets > 0 ? "100%" : "—"}
                </Text>
              </Group>
              <Text size="xs" c="dimmed">
                {t("liabilities")} + {t("netWorth")}
              </Text>
            </Group>
            <Box
              p={1}
              style={{
                border: "1px solid var(--mantine-color-default-border)",
                borderRadius: rem(999),
              }}
            >
              <Progress.Root
                size="md"
                radius="xl"
                aria-label={`${t("assets")}: ${t("liabilities")} + ${t("netWorth")}`}
              >
                <Progress.Section
                  value={assetComposition.netWorthBarShare}
                  color={netWorth >= 0 ? "blue" : "red"}
                />
                <Progress.Section
                  value={assetComposition.liabilityBarShare}
                  color="gray"
                />
              </Progress.Root>
            </Box>
            <Group justify="space-between" mt={8}>
              <Group gap={6}>
                <ColorSwatch
                  color={
                    netWorth >= 0
                      ? "var(--mantine-color-blue-6)"
                      : "var(--mantine-color-red-8)"
                  }
                  size={10}
                  withShadow={false}
                />
                <Text size="xs" c="dimmed">
                  {t("netWorth")} {percentageLabel(
                    assetComposition.netWorthPercentage,
                  )}
                </Text>
              </Group>
              <Group gap={6}>
                <Text size="xs" c="dimmed">
                  {t("liabilities")} {percentageLabel(
                    assetComposition.liabilityPercentage,
                  )}
                </Text>
                <ColorSwatch
                  color="var(--mantine-color-gray-6)"
                  size={10}
                  withShadow={false}
                />
              </Group>
            </Group>
          </Box>
        )}
      </Paper>

      {/* Assets & Liabilities cards */}
      <SimpleGrid cols={{ base: 1, sm: 2 }}>
        <Paper
          withBorder
          p="lg"
          radius="md"
          style={{ borderLeft: "4px solid var(--mantine-color-teal-6)" }}
        >
          <Group gap="md">
            <ThemeIcon size={44} radius="md" color="teal" variant="light">
              <IconBuildingBank size={22} />
            </ThemeIcon>
            <Box>
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
                size="xl"
              />
            </Box>
          </Group>
          {(assetCategories.length > 0 || depreciableAssetsTotal !== 0) && (
            <>
              <Divider mt="sm" mb="sm" />
              <Stack gap={4}>
                {assetCategories.map((c, index) => (
                  <Group key={c.key} justify="space-between">
                    <Group gap={4}>
                      {c.key === "lending" && (
                        <IconHandStop
                          size={12}
                          color="var(--mantine-color-teal-6)"
                        />
                      )}
                      <Text size="xs" c="dimmed">
                        {assetBreakdownLabel(
                          c.labelKey as Parameters<typeof t>[0],
                          index,
                        )}
                      </Text>
                    </Group>
                    <Text size="xs" fw={600} c="teal">
                      {fmt(c.total)}
                    </Text>
                  </Group>
                ))}
                {depreciableAssetsTotal !== 0 && (
                  <>
                    <Divider
                      my={4}
                      labelPosition="left"
                      label={
                        <Badge
                          size="xs"
                          variant="outline"
                          color="gray"
                          radius="sm"
                        >
                          {locale === "ja" ? "集計外" : "excluded"}
                        </Badge>
                      }
                    />
                    <Group justify="space-between">
                      <Text size="xs" c="dimmed" fs="italic">
                        {maskFinancialLabels
                          ? privateIndexedLabel(
                              t("typeAsset"),
                              assetCategories.length,
                            )
                          : t("sectionDepreciableAssets")}
                      </Text>
                      <Text size="xs" c="dimmed">
                        {fmt(depreciableAssetsTotal)}
                      </Text>
                    </Group>
                  </>
                )}
              </Stack>
            </>
          )}
          {donutData.length > 0 && (
            <Accordion
              variant="default"
              mt="sm"
              styles={{
                item: { border: "none" },
                control: { paddingInline: 0, paddingBlock: rem(4) },
                label: { paddingBlock: rem(2) },
                panel: { paddingInline: 0 },
                content: { paddingInline: 0, paddingBlock: rem(4) },
              }}
            >
              <Accordion.Item value="breakdown">
                <Accordion.Control>
                  <Text size="xs" c="dimmed">
                    {t("assetBreakdown")}
                  </Text>
                </Accordion.Control>
                <Accordion.Panel>
                  <Grid>
                    <Grid.Col span={{ base: 12, sm: 6 }}>
                      <DonutChart
                        data={donutData}
                        withTooltip={false}
                        size={160}
                        thickness={26}
                        mx="auto"
                        style={{ overflow: "visible" }}
                        pieProps={{ startAngle: 90, endAngle: -270 }}
                      />
                    </Grid.Col>
                    <Grid.Col span={{ base: 12, sm: 6 }}>
                      <Stack gap={4} justify="center" h="100%">
                        {donutData.map((item) => (
                          <Group
                            key={item.name}
                            justify="space-between"
                            wrap="nowrap"
                            gap="xs"
                          >
                            <Group
                              gap={6}
                              wrap="nowrap"
                              style={{ minWidth: 0 }}
                            >
                              <ColorSwatch
                                color={`var(--mantine-color-${item.color.replace(".", "-")})`}
                                size={10}
                                withShadow={false}
                              />
                              <Text size="xs" truncate style={{ minWidth: 0 }}>
                                {item.name}
                              </Text>
                            </Group>
                            <Text
                              size="xs"
                              fw={600}
                              style={{ whiteSpace: "nowrap" }}
                            >
                              {fmt(item.value)}
                            </Text>
                          </Group>
                        ))}
                      </Stack>
                    </Grid.Col>
                  </Grid>
                </Accordion.Panel>
              </Accordion.Item>
            </Accordion>
          )}
        </Paper>

        <Paper
          withBorder
          p="lg"
          radius="md"
          style={{ borderLeft: "4px solid var(--mantine-color-red-6)" }}
        >
          <Group gap="md" mb={totalLiabilities > 0 ? "sm" : 0}>
            <ThemeIcon size={44} radius="md" color="red" variant="light">
              <IconCreditCard size={22} />
            </ThemeIcon>
            <Box>
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
                size="xl"
              />
            </Box>
          </Group>
          {liabilityCategories.length > 0 && (
            <>
              <Divider mb="sm" />
              <Stack gap={4}>
                {liabilityCategories.map((c, index) => (
                  <Group key={c.key} justify="space-between">
                    <Text size="xs" c="dimmed">
                      {liabilityBreakdownLabel(
                        c.labelKey as Parameters<typeof t>[0],
                        index,
                      )}
                    </Text>
                    <Text size="xs" fw={600} c="red">
                      {fmt(c.total)}
                    </Text>
                  </Group>
                ))}
              </Stack>
            </>
          )}
        </Paper>
      </SimpleGrid>

      {/* Financial Health Indicator */}
      <Paper withBorder p="lg" radius="md">
        <Group justify="space-between" align="flex-start" mb="md">
          <Group gap="sm">
            <ThemeIcon
              size={40}
              radius="md"
              color={financialHealth.ratingColor}
              variant="light"
            >
              <IconActivity size={22} />
            </ThemeIcon>
            <Box>
              <Text size="xs" tt="uppercase" fw={700} c="dimmed">
                {t("fiscalHealthTitle")}
              </Text>
              <Group align="flex-end" gap={4}>
                <Text
                  fw={900}
                  c={financialHealth.ratingColor}
                  style={{ fontSize: rem(36), lineHeight: 1 }}
                >
                  {financialHealth.total}
                </Text>
                <Text c="dimmed" mb={rem(2)} size="sm">
                  /100
                </Text>
              </Group>
            </Box>
          </Group>
          <Badge
            size="lg"
            color={financialHealth.ratingColor}
            variant="filled"
            radius="md"
          >
            {t(
              financialHealth.rating === "safe"
                ? "fiscalHealthSafe"
                : financialHealth.rating === "caution"
                  ? "fiscalHealthCaution"
                  : "fiscalHealthDanger",
            )}
          </Badge>
        </Group>

        <Accordion
          variant="default"
          styles={{
            item: { border: "none" },
            control: { paddingInline: 0, paddingBlock: rem(4) },
            label: { paddingBlock: rem(2) },
            panel: { paddingInline: 0 },
            content: { paddingInline: 0, paddingBlock: rem(4) },
          }}
        >
          <Accordion.Item value="breakdown">
            <Accordion.Control>
              <Text size="xs" c="dimmed">
                {t("fiscalHealthBreakdown")}
              </Text>
            </Accordion.Control>
            <Accordion.Panel>
              <Stack gap="md">
                {/* 流動性比率 */}
                <Box>
                  <Group justify="space-between" mb={4}>
                    <Text size="sm" fw={600}>
                      {t("fiscalHealthLiquidity")}
                    </Text>
                    <Badge variant="light" color="teal" size="sm">
                      {financialHealth.liquidityScore}/30
                    </Badge>
                  </Group>
                  <Progress
                    value={(financialHealth.liquidityScore / 30) * 100}
                    color="teal"
                    size="sm"
                    radius="xl"
                    mb={4}
                  />
                  <Group gap={4} wrap="wrap">
                    <Text size="xs" c="dimmed">
                      {t("fiscalHealthCashLabel")}{" "}
                      {fmt(financialHealth.cashTotal)}
                    </Text>
                    <Text size="xs" c="dimmed">
                      /
                    </Text>
                    <Text size="xs" c="dimmed">
                      {t("fiscalHealthBaseLabel")}{" "}
                      {fmt(financialHealth.liquidityBase)}
                    </Text>
                    <Text size="xs" c="dimmed">
                      =
                    </Text>
                    <Text size="xs" c="dimmed" fw={600}>
                      {(financialHealth.liquidityRatio * 100).toFixed(1)}%
                    </Text>
                    <Text size="xs" c="dimmed">
                      ({t("fiscalHealthThreshold50")})
                    </Text>
                  </Group>
                </Box>

                {/* 純資産比率 */}
                <Box>
                  <Group justify="space-between" mb={4}>
                    <Text size="sm" fw={600}>
                      {t("fiscalHealthEquity")}
                    </Text>
                    <Badge variant="light" color="blue" size="sm">
                      {financialHealth.equityScore}/30
                    </Badge>
                  </Group>
                  <Progress
                    value={(financialHealth.equityScore / 30) * 100}
                    color="blue"
                    size="sm"
                    radius="xl"
                    mb={4}
                  />
                  <Group gap={4} wrap="wrap">
                    <Text size="xs" c="dimmed">
                      {t("fiscalHealthNetWorthLabel")} {fmt(netWorth)}
                    </Text>
                    <Text size="xs" c="dimmed">
                      /
                    </Text>
                    <Text size="xs" c="dimmed">
                      {t("assets")} {fmt(totalAssets)}
                    </Text>
                    <Text size="xs" c="dimmed">
                      =
                    </Text>
                    <Text size="xs" c="dimmed" fw={600}>
                      {(financialHealth.equityRatio * 100).toFixed(1)}%
                    </Text>
                    <Text size="xs" c="dimmed">
                      ({t("fiscalHealthThreshold60")})
                    </Text>
                  </Group>
                </Box>

                {/* 支出余力 */}
                <Box>
                  <Group justify="space-between" mb={4}>
                    <Text size="sm" fw={600}>
                      {t("fiscalHealthSpending")}
                    </Text>
                    <Badge variant="light" color="violet" size="sm">
                      {financialHealth.spendingScore}/40
                    </Badge>
                  </Group>
                  <Progress
                    value={(financialHealth.spendingScore / 40) * 100}
                    color="violet"
                    size="sm"
                    radius="xl"
                    mb={4}
                  />
                  {financialHealth.hasSpendingData ? (
                    <Group gap={4} wrap="wrap">
                      <Text size="xs" c="dimmed">
                        {t("fiscalHealthCashLabel")}{" "}
                        {fmt(financialHealth.cashTotal)}
                      </Text>
                      <Text size="xs" c="dimmed">
                        /
                      </Text>
                      <Text size="xs" c="dimmed">
                        {t("fiscalHealthAnnualEstLabel")}{" "}
                        {fmt(Math.round(financialHealth.annualEstimate))}
                      </Text>
                      <Text size="xs" c="dimmed">
                        =
                      </Text>
                      <Text size="xs" c="dimmed" fw={600}>
                        {(financialHealth.spendingRatio! * 100).toFixed(1)}%
                      </Text>
                      <Text size="xs" c="dimmed">
                        ({t("fiscalHealthThreshold100")})
                      </Text>
                    </Group>
                  ) : (
                    <Text size="xs" c="dimmed">
                      {t("fiscalHealthNoExpenseData")}
                    </Text>
                  )}
                </Box>
              </Stack>
            </Accordion.Panel>
          </Accordion.Item>
        </Accordion>
      </Paper>

      {/* Sub-page navigation */}
      <SimpleGrid cols={{ base: 2, sm: 3 }} mt="sm">
        {(
          [
            {
              to: "/fs/tt",
              Icon: IconScale,
              label: t("tabTrialBalance"),
              desc: t("tabTrialBalanceDesc"),
              color: "violet",
            },
            {
              to: "/fs/bs",
              Icon: IconFileAnalytics,
              label: t("tabBalanceSheet"),
              desc: t("tabBalanceSheetDesc"),
              color: "blue",
            },
            {
              to: "/fs/pl",
              Icon: IconReportMoney,
              label: t("tabPL"),
              desc: t("tabPLDesc"),
              color: "teal",
            },
            {
              to: "/fs/crypto",
              Icon: IconCurrencyBitcoin,
              label: t("navCrypto"),
              desc: t("navCryptoDesc"),
              color: "orange",
            },
            {
              to: "/fs/db",
              Icon: IconCoin,
              label: t("tabLoanMgmt"),
              desc: t("tabLoanMgmtDesc"),
              color: "grape",
            },
            {
              to: "/fs/sv",
              Icon: IconPigMoney,
              label: t("tabSavings"),
              desc: t("tabSavingsDesc"),
              color: "green",
            },
          ] as const
        ).map(({ to, Icon, label, desc, color }) => {
          const isTrialBalanceBtn = to === "/fs/tt";
          const isLoanBtn = to === "/fs/db";
          const showBadge = isLoanBtn && unresolvedShortTermCount > 0;
          return (
            <Box
              key={to}
              pos="relative"
              style={{
                overflow: "visible",
                gridColumn: isTrialBalanceBtn ? "1 / -1" : undefined,
              }}
            >
              <Button
                component={Link}
                to={to}
                variant={isTrialBalanceBtn ? "light" : "default"}
                color={isTrialBalanceBtn ? "violet" : undefined}
                w="100%"
                styles={{
                  root: {
                    height: "auto",
                    padding: isTrialBalanceBtn ? rem(24) : rem(16),
                  },
                  inner: { flexDirection: "column" },
                  label: {
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: rem(4),
                  },
                }}
              >
                <ThemeIcon
                  size={isTrialBalanceBtn ? 64 : 48}
                  radius="md"
                  color={color}
                  variant="light"
                >
                  <Icon size={isTrialBalanceBtn ? 34 : 26} />
                </ThemeIcon>
                <Text
                  size={isTrialBalanceBtn ? "lg" : "sm"}
                  fw={isTrialBalanceBtn ? 700 : 600}
                  ta="center"
                  style={{ whiteSpace: "normal" }}
                >
                  {label}
                </Text>
                <Text
                  size={isTrialBalanceBtn ? "sm" : "xs"}
                  c="dimmed"
                  ta="center"
                  style={{ whiteSpace: "normal" }}
                >
                  {desc}
                </Text>
              </Button>
              {showBadge && (
                <Box
                  pos="absolute"
                  style={{
                    top: 6,
                    right: 6,
                    zIndex: 10,
                    minWidth: 20,
                    height: 20,
                    borderRadius: 10,
                    background: "var(--mantine-color-red-6)",
                    color: "#fff",
                    fontSize: rem(11),
                    fontWeight: 700,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: "0 5px",
                    lineHeight: 1,
                    pointerEvents: "none",
                    boxShadow: "0 0 0 2px var(--mantine-color-body)",
                  }}
                >
                  {unresolvedShortTermCount}
                </Box>
              )}
            </Box>
          );
        })}
      </SimpleGrid>

      {/* Net worth history chart — only shown when ≥ 2 months of data */}
      {netWorthHistory.length >= 2 && (
        <NetWorthChart
          data={netWorthHistory}
          displayCurrency={displayCurrency}
          displayCurrencySymbol={displayCurrencySymbol}
        />
      )}

      {/* Monthly expense stacked bar chart */}
      <ExpenseBarChart
        journal={journal}
        accounts={accounts}
        includeAllCurrencies={includeAllCurrencies}
      />
    </Stack>
  );
}
