import { Group, Paper, Stack, Text } from "@mantine/core";
import { useMemo } from "react";
import type { JournalEntry } from "@balance-sheet/shared";
import { useAppData } from "../context/AppDataContext";
import { useLang } from "../i18n";
import { summarizeExpenseTags } from "../lib/expenseTagSummary";
import { formatCurrency } from "../lib/numberFormat";

export function ExpenseTagSummary({ entries, selectedTagIds = [], includeAllCurrencies = false }: {
  entries: readonly JournalEntry[]; selectedTagIds?: readonly number[]; includeAllCurrencies?: boolean;
}) {
  const { t, locale } = useLang();
  const { accounts, displayCurrency, displayCurrencySymbol, convertCurrency } = useAppData();
  const summary = useMemo(() => summarizeExpenseTags(entries, accounts, {
    currency: displayCurrency, convertCurrency, includeAllCurrencies, selectedTagIds,
  }), [entries, accounts, displayCurrency, convertCurrency, includeAllCurrencies, selectedTagIds]);
  if (!summary.byTag.length && !selectedTagIds.length) return null;
  const fmt = (amount: number) => formatCurrency(amount, locale, displayCurrency, displayCurrencySymbol);
  return <Paper withBorder p="md" radius="md" data-testid="expense-tag-summary">
    <Stack gap="xs">
      <Group justify="space-between">
        <Text fw={600}>{t("tagExpenseTotal")}</Text>
        <Text fw={700} className="currency-token">{fmt(summary.total)}</Text>
      </Group>
      <Text size="xs" c="dimmed">{t("tagExpenseSummaryHint")}</Text>
      {summary.byTag.length > 0 && <>
        <Text size="sm" fw={600}>{t("tagExpenseBreakdown")}</Text>
        {summary.byTag.map(tag => <Group key={tag.id} justify="space-between" wrap="nowrap" gap="sm">
          <Text size="sm" style={{ overflowWrap: "anywhere", minWidth: 0 }}>{tag.name}</Text>
          <Text size="sm" className="currency-token" style={{ flexShrink: 0 }}>{fmt(tag.amount)}</Text>
        </Group>)}
        <Text size="xs" c="dimmed">{t("tagExpenseBreakdownHint")}</Text>
      </>}
    </Stack>
  </Paper>;
}
