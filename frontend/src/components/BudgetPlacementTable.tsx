import {
  Accordion,
  Alert,
  Badge,
  Group,
  Paper,
  ScrollArea,
  SimpleGrid,
  Stack,
  Table,
  Text,
  ThemeIcon,
  Title,
} from "@mantine/core";
import type { Account, BudgetCategorySummary } from "@balance-sheet/shared";
import {
  IconAlertTriangle,
  IconCoins,
  IconLock,
  IconWallet,
} from "@tabler/icons-react";
import { useLang } from "../i18n";
import { useAppData } from "../context/AppDataContext";
import {
  accountDisplayNameFromName,
} from "../lib/accountUtils";
import { formatCurrency } from "../lib/numberFormat";
import {
  calculateBudgetPlacement,
  generateBudgetPlacementPlan,
} from "../lib/budgetPlacement";
import {
  sumBudgetResourceBalances,
  summarizeBudgetFunding,
} from "../lib/allocatableBudget";

function formatSignedCurrency(
  amount: number,
  locale: string,
  currency: string,
  decimalPlaces?: number,
) {
  return `${amount >= 0 ? "+" : ""}${formatCurrency(amount, locale, currency, undefined, decimalPlaces)}`;
}

export function BudgetPlacementTable({
  accounts,
  categorySummaries,
  currency,
  title,
}: {
  accounts: Account[];
  categorySummaries: BudgetCategorySummary[];
  currency: string;
  title?: string;
}) {
  const { t, locale } = useLang();
  const { enabledCurrencies } = useAppData();
  const placement = calculateBudgetPlacement({
    accounts,
    categorySummaries,
    currency,
  });
  const decimalPlaces = enabledCurrencies.find(
    (enabled) => enabled.code.toUpperCase() === currency.toUpperCase(),
  )?.decimal_places ?? 0;
  const plan = generateBudgetPlacementPlan({
    accounts,
    categorySummaries,
    currency,
    decimalPlaces,
  });
  const hasUnplaced =
    placement.unplacedBudget !== 0 || placement.unplacedAccounts.length > 0;
  const unplacedActual = placement.unplacedAccounts.reduce(
    (sum, account) => sum + account.amount,
    0,
  );
  const totalExpected =
    placement.placementGroups.reduce(
      (sum, group) => sum + group.expected,
      0,
    ) + placement.unplacedBudget;
  const totalActual =
    placement.placementGroups.reduce(
      (sum, group) => sum + group.actual,
      0,
    ) + unplacedActual;
  const totalDifference = totalActual - totalExpected;
  const fundingSummary = summarizeBudgetFunding(
    sumBudgetResourceBalances(accounts, currency),
    categorySummaries.map((summary) => summary.available),
    categorySummaries.reduce(
      (sum, summary) => sum + (summary.reference_reserve ?? 0),
      0,
    ),
    categorySummaries.reduce(
      (sum, summary) => sum + (summary.depreciation_non_cash_offset ?? 0),
      0,
    ),
  );
  const depreciationReserve = categorySummaries.reduce(
    (sum, summary) => sum + (summary.depreciation_reserve ?? 0),
    0,
  );
  const securedAmount =
    fundingSummary.positiveBudgetClaims +
    fundingSummary.referenceReserve +
    fundingSummary.depreciationNonCashOffset;
  const reconciliationIsClear =
    Math.abs(fundingSummary.adjustedReconciliationGap) < 0.000_001;

  return (
    <Stack gap="md">
      <Group justify="space-between" align="flex-start">
        <Stack gap={2}>
          <Title order={4}>{title ?? t("budgetPlacementTitle")}</Title>
          <Text size="sm" c="dimmed">
            {t("budgetPlacementTableHint")}
          </Text>
        </Stack>
        {hasUnplaced && (
          <Badge color="gray" variant="light">
            {t("budgetPlacementUnplaced")}:{" "}
            {formatCurrency(
              placement.unplacedBudget,
              locale,
              currency,
            )}
          </Badge>
        )}
      </Group>

      <Paper withBorder radius="lg" p="md">
        <Text fw={700}>{t("budgetFundingOverviewTitle")}</Text>
        <Text size="sm" c="dimmed" mt={2}>
          {t("budgetFundingOverviewHint")}
        </Text>

        <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="sm" mt="md">
          <Paper withBorder radius="md" p="sm">
            <Group gap="sm" wrap="nowrap">
              <ThemeIcon variant="light" color="blue" radius="xl">
                <IconWallet size={17} />
              </ThemeIcon>
              <Stack gap={2} style={{ minWidth: 0 }}>
                <Text size="xs" c="dimmed">
                  {t("budgetReconciliationCash")}
                </Text>
                <Text fw={750} className="currency-token">
                  {formatCurrency(
                    fundingSummary.allocatableCash,
                    locale,
                    currency,
                  )}
                </Text>
              </Stack>
            </Group>
          </Paper>

          <Paper withBorder radius="md" p="sm">
            <Group gap="sm" wrap="nowrap">
              <ThemeIcon variant="light" color="violet" radius="xl">
                <IconLock size={17} />
              </ThemeIcon>
              <Stack gap={2} style={{ minWidth: 0 }}>
                <Text size="xs" c="dimmed">
                  {t("budgetFundingReservedLabel")}
                </Text>
                <Text fw={750} className="currency-token">
                  {formatCurrency(securedAmount, locale, currency)}
                </Text>
              </Stack>
            </Group>
          </Paper>

          <Paper
            withBorder
            radius="md"
            p="sm"
            style={{
              background:
                fundingSummary.fundingGap >= 0
                  ? "var(--mantine-color-teal-light)"
                  : "var(--mantine-color-orange-light)",
            }}
          >
            <Group gap="sm" wrap="nowrap">
              <ThemeIcon
                variant="filled"
                color={fundingSummary.fundingGap >= 0 ? "teal" : "orange"}
                radius="xl"
              >
                <IconCoins size={17} />
              </ThemeIcon>
              <Stack gap={2} style={{ minWidth: 0 }}>
                <Text size="xs" c="dimmed">
                  {t(
                    fundingSummary.fundingGap >= 0
                      ? "budgetFundingAvailableLabel"
                      : "budgetFundingShortageLabel",
                  )}
                </Text>
                <Text
                  fw={800}
                  c={fundingSummary.fundingGap >= 0 ? "teal" : "orange"}
                  className="currency-token"
                >
                  {formatSignedCurrency(
                    fundingSummary.fundingGap,
                    locale,
                    currency,
                  )}
                </Text>
              </Stack>
            </Group>
          </Paper>
        </SimpleGrid>

        <Text size="xs" c="dimmed" ta="center" mt="sm">
          {formatCurrency(fundingSummary.allocatableCash, locale, currency)} −{" "}
          {formatCurrency(securedAmount, locale, currency)} ={" "}
          {formatSignedCurrency(fundingSummary.fundingGap, locale, currency)}
        </Text>

        <Accordion variant="contained" radius="md" mt="md">
          <Accordion.Item value="reconciliation-details">
            <Accordion.Control>
              {t("budgetReconciliationDetails")}
            </Accordion.Control>
            <Accordion.Panel>
              <Table fz="sm" withRowBorders={false}>
                <Table.Tbody>
                  {[
                    [
                      t("budgetReconciliationNetBudget"),
                      fundingSummary.netBudgetBalance,
                    ],
                    [
                      t("budgetReconciliationNetGap"),
                      fundingSummary.reconciliationGap,
                    ],
                    [
                      t("budgetReconciliationReferenceReserve"),
                      fundingSummary.referenceReserve,
                    ],
                    [
                      t("budgetReconciliationDepreciationReserve"),
                      depreciationReserve,
                    ],
                    [
                      t("budgetReconciliationDepreciationOffset"),
                      fundingSummary.depreciationNonCashOffset,
                    ],
                    [
                      t("budgetReconciliationAdjustedGap"),
                      fundingSummary.adjustedReconciliationGap,
                    ],
                    [
                      t("budgetReconciliationPositiveClaims"),
                      fundingSummary.positiveBudgetClaims,
                    ],
                  ].map(([label, amount]) => (
                    <Table.Tr key={String(label)}>
                      <Table.Td>{label}</Table.Td>
                      <Table.Td className="currency-cell">
                        <Text
                          size="sm"
                          fw={600}
                          c={
                            label === t("budgetReconciliationAdjustedGap")
                              ? reconciliationIsClear
                                ? "teal"
                                : "orange"
                              : undefined
                          }
                        >
                          {formatSignedCurrency(
                            amount as number,
                            locale,
                            currency,
                          )}
                        </Text>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
              <Text size="xs" c="dimmed" mt="xs">
                {t("budgetReconciliationHint")
                  .replace(
                    "{overspending}",
                    formatCurrency(
                      fundingSummary.unfundedOverspending,
                      locale,
                      currency,
                    ),
                  )
                  .replace(
                    "{gap}",
                    formatSignedCurrency(
                      fundingSummary.reconciliationGap,
                      locale,
                      currency,
                    ),
                  )
                  .replace(
                    "{reference}",
                    formatCurrency(
                      fundingSummary.referenceReserve,
                      locale,
                      currency,
                    ),
                  )
                  .replace(
                    "{adjustedGap}",
                    formatSignedCurrency(
                      fundingSummary.adjustedReconciliationGap,
                      locale,
                      currency,
                    ),
                  )
                  .replace(
                    "{depreciation}",
                    formatCurrency(
                      fundingSummary.depreciationNonCashOffset,
                      locale,
                      currency,
                    ),
                  )}
              </Text>
            </Accordion.Panel>
          </Accordion.Item>
        </Accordion>
      </Paper>

      {placement.unfundedOverspending > 0 && (
        <Alert
          color="orange"
          variant="light"
          icon={<IconAlertTriangle size={18} />}
          title={t("budgetPlacementUnfundedOverspending")}
        >
          <Stack gap={4}>
            <Text size="sm">
              {formatCurrency(
                placement.unfundedOverspending,
                locale,
                currency,
              )}
            </Text>
            <Text size="xs">
              {t("budgetPlacementUnfundedOverspendingHint")}
            </Text>
            {placement.overspendingCategories.map((category) => (
              <Text
                key={category.budget_category_id}
                size="xs"
                c="dimmed"
              >
                {category.budget_category_name}:{" "}
                {formatCurrency(category.amount, locale, currency)}
              </Text>
            ))}
          </Stack>
        </Alert>
      )}

      {placement.placementGroups.length === 0 && !hasUnplaced ? (
        <Text size="sm" c="dimmed">
          {t("budgetPlacementEmpty")}
        </Text>
      ) : (
        <ScrollArea>
          <Table withTableBorder withColumnBorders style={{ minWidth: 980 }}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t("budgetPlacementAccounts")}</Table.Th>
                <Table.Th className="currency-cell">
                  {t("budgetPlacementRequired")}
                </Table.Th>
                <Table.Th className="currency-cell">
                  {t("budgetPlacementHeld")}
                </Table.Th>
                <Table.Th className="currency-cell">
                  {t("budgetPlacementSurplusShortage")}
                </Table.Th>
                <Table.Th className="currency-cell">
                  {t("budgetPlacementAfterTransfers")}
                </Table.Th>
                <Table.Th className="currency-cell">
                  {t("budgetPlacementAfterCardDebt")}
                </Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {plan.groups.map((row) => (
                <Table.Tr key={row.group_id}>
                  <Table.Td>
                    <Stack gap={2}>
                      {row.account_names.map((accountName) => (
                        <Text key={accountName} size="sm">
                          {accountDisplayNameFromName(accountName, t)}
                        </Text>
                      ))}
                    </Stack>
                  </Table.Td>
                  <Table.Td className="currency-cell">
                    <Stack gap={4} align="flex-end">
                      <Text size="sm" fw={600}>
                        {formatCurrency(row.expected, locale, currency)}
                      </Text>
                      {row.categories.length > 0 && (
                        <Stack gap={2} align="flex-end">
                          {row.categories.map((category) => (
                            <Text
                              key={category.budget_category_id}
                              size="xs"
                              c="dimmed"
                            >
                              {category.budget_category_name}:{" "}
                              {formatCurrency(
                                category.amount,
                                locale,
                                currency,
                              )}
                            </Text>
                          ))}
                        </Stack>
                      )}
                    </Stack>
                  </Table.Td>
                  <Table.Td className="currency-cell">
                    <Stack gap={4} align="flex-end">
                      <Text size="sm" fw={600}>
                        {formatCurrency(row.actual, locale, currency)}
                      </Text>
                      {row.accounts.length > 0 && (
                        <Stack gap={2} align="flex-end">
                          {row.accounts.map((account) => (
                            <Text
                              key={account.account_id}
                              size="xs"
                              c="dimmed"
                            >
                              {accountDisplayNameFromName(
                                account.account_name,
                                t,
                              )}
                              :{" "}
                              {formatCurrency(account.amount, locale, currency)}
                            </Text>
                          ))}
                        </Stack>
                      )}
                    </Stack>
                  </Table.Td>
                  <Table.Td className="currency-cell">
                    <Text
                      size="sm"
                      fw={600}
                      c={row.difference >= 0 ? "teal" : "orange"}
                    >
                      {formatSignedCurrency(row.difference, locale, currency)}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {t(
                        row.difference >= 0
                          ? "budgetPlacementSurplus"
                          : "budgetPlacementShortage",
                      )}
                    </Text>
                  </Table.Td>
                  <Table.Td className="currency-cell">
                    <Text size="sm" fw={600} c={row.after_difference >= 0 ? "teal" : "orange"}>
                      {formatSignedCurrency(row.after_difference, locale, currency, decimalPlaces)}
                    </Text>
                  </Table.Td>
                  <Table.Td className="currency-cell">
                    <Text size="xs" c="dimmed">{t("budgetPlacementCardDebtTotalOnly")}</Text>
                  </Table.Td>
                </Table.Tr>
              ))}
              {hasUnplaced && (
                <Table.Tr>
                  <Table.Td>
                    <Text size="sm" fw={600}>
                      {t("budgetPlacementUnplaced")}
                    </Text>
                    {placement.unplacedAccounts.map((account) => (
                      <Text key={account.account_id} size="xs" c="dimmed">
                        {accountDisplayNameFromName(account.account_name, t)}
                      </Text>
                    ))}
                  </Table.Td>
                  <Table.Td className="currency-cell">
                    {formatCurrency(placement.unplacedBudget, locale, currency)}
                  </Table.Td>
                  <Table.Td className="currency-cell">
                    <Stack gap={2} align="flex-end">
                      <Text size="sm">
                        {formatCurrency(
                          unplacedActual,
                          locale,
                          currency,
                        )}
                      </Text>
                      {placement.unplacedAccounts.map((account) => (
                        <Text key={account.account_id} size="xs" c="dimmed">
                          {formatCurrency(account.amount, locale, currency)}
                        </Text>
                      ))}
                    </Stack>
                  </Table.Td>
                  <Table.Td className="currency-cell">
                    <Text
                      size="sm"
                      fw={600}
                      c={placement.unplacedDifference >= 0 ? "teal" : "orange"}
                    >
                      {formatSignedCurrency(
                        placement.unplacedDifference,
                        locale,
                        currency,
                      )}
                    </Text>
                  </Table.Td>
                  <Table.Td className="currency-cell">
                    <Text size="sm" fw={600} c={plan.unplaced_after_difference >= 0 ? "teal" : "orange"}>
                      {formatSignedCurrency(plan.unplaced_after_difference, locale, currency, decimalPlaces)}
                    </Text>
                  </Table.Td>
                  <Table.Td className="currency-cell">
                    <Text size="xs" c="dimmed">{t("budgetPlacementCardDebtTotalOnly")}</Text>
                  </Table.Td>
                </Table.Tr>
              )}
            </Table.Tbody>
            <Table.Tfoot>
              <Table.Tr>
                <Table.Th>{t("budgetPlacementTotal")}</Table.Th>
                <Table.Th className="currency-cell">
                  {formatCurrency(totalExpected, locale, currency)}
                </Table.Th>
                <Table.Th className="currency-cell">
                  {formatCurrency(totalActual, locale, currency)}
                </Table.Th>
                <Table.Th className="currency-cell">
                  <Text
                    size="sm"
                    fw={700}
                    c={totalDifference >= 0 ? "teal" : "orange"}
                  >
                    {formatSignedCurrency(totalDifference, locale, currency)}
                  </Text>
                </Table.Th>
                <Table.Th className="currency-cell">
                  <Text
                    size="sm"
                    fw={700}
                    c={plan.after_total_difference >= 0 ? "teal" : "orange"}
                  >
                    {formatSignedCurrency(plan.after_total_difference, locale, currency, decimalPlaces)}
                  </Text>
                </Table.Th>
                <Table.Th className="currency-cell">
                  <Text
                    size="sm"
                    fw={700}
                    c={plan.adjusted_total_difference >= 0 ? "teal" : "orange"}
                  >
                    {formatSignedCurrency(plan.adjusted_total_difference, locale, currency, decimalPlaces)}
                  </Text>
                  {plan.liabilities.map((liability) => (
                    <Text key={liability.account_id} size="xs" c="dimmed">
                      {accountDisplayNameFromName(liability.account_name, t)}: {formatCurrency(liability.amount, locale, currency, undefined, decimalPlaces)}
                    </Text>
                  ))}
                </Table.Th>
              </Table.Tr>
            </Table.Tfoot>
          </Table>
        </ScrollArea>
      )}

      <Text size="xs" c="dimmed">{t("budgetPlacementCardDebtAdjustmentHint")}</Text>
    </Stack>
  );
}
