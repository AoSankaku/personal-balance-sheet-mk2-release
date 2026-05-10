import { Badge, Group, List, ScrollArea, Stack, Table, Text, Title } from "@mantine/core";
import type { Account, BudgetCategorySummary } from "@balance-sheet/shared";
import { useLang } from "../i18n";
import { formatCurrency } from "../lib/numberFormat";
import {
  calculateBudgetPlacement,
  generateBudgetPlacementHints,
  type BudgetPlacementHint,
} from "../lib/budgetPlacement";

function formatSignedCurrency(
  amount: number,
  locale: string,
  currency: string,
) {
  return `${amount >= 0 ? "+" : ""}${formatCurrency(amount, locale, currency)}`;
}

function renderHint(
  hint: BudgetPlacementHint,
  locale: string,
  currency: string,
) {
  const amount = formatCurrency(Math.abs(hint.amount), locale, currency);
  const target =
    hint.target?.replace(
      "unplaced budgets",
      locale === "ja" ? "未配置予算" : "unplaced budgets",
    ) ?? "";
  if (hint.type === "move_cash") {
    if (locale === "ja") {
      return `${hint.from} から ${hint.to} へ ${amount} 移動`;
    }
    return `Move ${amount} from ${hint.from} to ${hint.to}`;
  }
  if (hint.type === "allocate_budget") {
    if (locale === "ja") {
      return `${target} に ${amount} 追加で割り当て`;
    }
    return `Allocate ${amount} more to ${target}`;
  }
  if (hint.type === "reduce_budget") {
    if (locale === "ja") {
      return `${target} を ${amount} 減らす、または対象口座へ入金`;
    }
    return `Reduce ${target} by ${amount}, or add cash to its target account`;
  }
  if (locale !== "ja") {
    const action =
      hint.amount > 0
        ? "allocate more to unplaced budgets"
        : "reduce unplaced budgets";
    return `${target}: ${amount} ${action}`;
  }
  const direction =
    hint.amount > 0 ? "未配置予算へ追加割り当て" : "未配置予算を減額";
  return `${target}: ${amount} ${direction}`;
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
  const placement = calculateBudgetPlacement({
    accounts,
    categorySummaries,
    currency,
  });
  const hints = generateBudgetPlacementHints(placement);
  const hasUnplaced =
    placement.unplacedBudget !== 0 || placement.unplacedAccounts.length > 0;

  return (
    <Stack gap="md">
      <Group justify="space-between">
        <Title order={4}>{title ?? t("budgetPlacementTitle")}</Title>
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

      {placement.placementGroups.length === 0 && !hasUnplaced ? (
        <Text size="sm" c="dimmed">
          {t("budgetPlacementEmpty")}
        </Text>
      ) : (
        <ScrollArea>
          <Table withTableBorder withColumnBorders style={{ minWidth: 680 }}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t("accountName")}</Table.Th>
                <Table.Th className="currency-cell">
                  {t("budgetPlacementExpected")}
                </Table.Th>
                <Table.Th className="currency-cell">
                  {t("budgetPlacementActual")}
                </Table.Th>
                <Table.Th className="currency-cell">
                  {t("budgetPlacementDifference")}
                </Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {placement.placementGroups.map((row) => (
                <Table.Tr key={row.group_id}>
                  <Table.Td>
                    <Stack gap={2}>
                      {row.account_names.map((accountName) => (
                        <Text key={accountName} size="sm">
                          {accountName}
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
                              {account.account_name}:{" "}
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
                        {account.account_name}
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
                          placement.unplacedAccounts.reduce(
                            (sum, account) => sum + account.amount,
                            0,
                          ),
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
                </Table.Tr>
              )}
            </Table.Tbody>
          </Table>
        </ScrollArea>
      )}

      {hints.length > 0 && (
        <Stack gap={4}>
          <Text size="sm" fw={600}>
            {t("budgetPlacementHintsTitle")}
          </Text>
          <List size="sm" spacing={2}>
            {hints.map((hint, index) => (
              <List.Item key={index}>
                {renderHint(hint, locale, currency)}
              </List.Item>
            ))}
          </List>
        </Stack>
      )}
    </Stack>
  );
}
