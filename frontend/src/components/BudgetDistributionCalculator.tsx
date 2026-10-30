import { Alert, Button, Group, NumberInput, ScrollArea, SegmentedControl, Select, SimpleGrid, Stack, Table, Text } from "@mantine/core";
import { useState } from "react";
import type { Account, BudgetCategory, BudgetFilter, CreateJournalLineInput } from "@balance-sheet/shared";
import { useLang, type TranslationKey } from "../i18n";
import { toAccountOption, renderAccountOption } from "../lib/accountSelect";
import { isUserSelectableAccount } from "../lib/accountUtils";
import { formatCurrency } from "../lib/numberFormat";
import { calculateAccountBudgetDistribution, calculateJournalBudgetDistribution } from "../lib/budgetDistributionCalculator";

export interface BudgetCalculatorApplication {
  expense?: Record<number, number>;
  income?: Record<number, number>;
}

interface Props {
  accounts: Account[];
  categories: BudgetCategory[];
  filters: BudgetFilter[];
  lines: CreateJournalLineInput[];
  currency: string;
  decimalPlaces: number;
  currencySymbol: string;
  incomeLocked?: boolean;
  onApply: (values: BudgetCalculatorApplication) => void;
  onClose: () => void;
}

const issueKeys: Record<string, TranslationKey> = {
  invalid: "budgetCalculatorInvalid",
  unbalanced: "budgetCalculatorUnbalanced",
  unknown_account: "budgetCalculatorInvalid",
  unsupported: "budgetCalculatorUnsupported",
  ambiguous: "budgetCalculatorAmbiguous",
  funding: "budgetCalculatorFundingHint",
  filter_currency: "budgetCalculatorInvalidFilter",
  invalid_category: "budgetCalculatorInvalidCategory",
  overallocated: "budgetCalculatorOverallocated",
};

export function BudgetDistributionCalculator({
  accounts, categories, filters, lines, currency, decimalPlaces, currencySymbol,
  incomeLocked = false, onApply, onClose,
}: Props) {
  const { t, locale } = useLang();
  const initialAccount = lines.map(line => accounts.find(account => account.id === line.account_id))
    .find(account => account?.type === "expense" || account?.type === "income");
  const [mode, setMode] = useState<"account" | "journal">(
    lines.some(line => line.debit !== 0 || line.credit !== 0) ? "journal" : "account",
  );
  const [accountId, setAccountId] = useState<string | null>(initialAccount ? String(initialAccount.id) : null);
  const [amount, setAmount] = useState<number | string>(() => Math.abs(lines
    .filter(line => line.account_id === initialAccount?.id)
    .reduce((sum, line) => sum + line.debit - line.credit, 0)));
  const [direction, setDirection] = useState<"debit" | "credit">(initialAccount?.type === "income" ? "credit" : "debit");
  const [filterId, setFilterId] = useState<string | null>(null);
  const [fallbackCategoryId, setFallbackCategoryId] = useState<string | null>(null);
  const account = accounts.find(candidate => String(candidate.id) === accountId);
  const filter = filters.find(candidate => String(candidate.id) === filterId);
  const options = {
    categories, filter, currency, decimalPlaces,
    fallbackCategoryId: fallbackCategoryId ? Number(fallbackCategoryId) : null,
  };
  const result = mode === "account"
    ? calculateAccountBudgetDistribution({ ...options, account, amount: Number(amount), direction })
    : calculateJournalBudgetDistribution({ ...options, lines, accounts });
  const format = (value: number) => formatCurrency(value, locale, currency, currencySymbol, decimalPlaces);
  const needsIncome = mode === "account" ? account?.type === "income"
    : result.incomeTarget !== 0 || lines.some(line => accounts.find(candidate => candidate.id === line.account_id)?.type === "income");
  const incomeBlocked = incomeLocked && (mode === "journal" || account?.type === "income");
  const categoryIds = new Set([...Object.keys(result.expense), ...Object.keys(result.income)].map(Number));
  const rows = categories.filter(category => categoryIds.has(category.id));

  return (
    <Stack gap="md">
      <Text size="sm" c="dimmed">{t("budgetCalculatorScratchHint")}</Text>
      <SegmentedControl
        value={mode}
        onChange={value => setMode(value as "account" | "journal")}
        data={[
          { value: "account", label: t("budgetCalculatorAccountMode") },
          { value: "journal", label: t("budgetCalculatorJournalMode") },
        ]}
        fullWidth
        styles={{ label: { whiteSpace: "normal" } }}
      />
      {mode === "account" && <>
        <Select
          label={t("thAccount")}
          value={accountId}
          onChange={value => {
            setAccountId(value);
            setDirection(accounts.find(candidate => String(candidate.id) === value)?.type === "income" ? "credit" : "debit");
          }}
          data={(["expense", "income"] as const).map(type => ({
            group: t(type === "expense" ? "typeExpense" : "typeIncome"),
            items: accounts.filter(candidate => candidate.type === type && isUserSelectableAccount(candidate)).map(candidate => toAccountOption(candidate, t)),
          })).filter(group => group.items.length > 0)}
          renderOption={renderAccountOption}
          searchable
          clearable
        />
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <NumberInput label={t("amountLabel")} value={amount} onChange={setAmount} min={0}
            decimalScale={decimalPlaces} step={10 ** -decimalPlaces} prefix={currencySymbol} thousandSeparator="," />
          <Select label={t("budgetCalculatorSide")} value={direction}
            onChange={value => setDirection(value === "credit" ? "credit" : "debit")}
            allowDeselect={false}
            data={[{ value: "debit", label: t("debitColHeader") }, { value: "credit", label: t("creditColHeader") }]} />
        </SimpleGrid>
      </>}
      {needsIncome && <Select
        label={t("budgetFilterTitle")}
        data={filters.filter(candidate => candidate.is_active && candidate.currency.toUpperCase() === currency.toUpperCase())
          .map(candidate => ({ value: String(candidate.id), label: candidate.name }))}
        value={filterId} onChange={setFilterId} clearable
      />}
      <Select
        label={t("budgetCalculatorRemainderCategory")}
        description={t("budgetCalculatorRemainderHint")}
        data={categories.map(category => ({ value: String(category.id), label: category.name }))}
        value={fallbackCategoryId} onChange={setFallbackCategoryId} clearable searchable
      />
      {result.issue && result.issue !== "unassigned" && <Alert color="yellow">{t(issueKeys[result.issue] ?? "budgetCalculatorUnsupported")}</Alert>}
      <SimpleGrid cols={{ base: 1, sm: 2 }}>
        <Stack gap={2}>
          <Text size="xs" c="dimmed">{t("budgetCalculatorExpenseTotal")}</Text>
          <Text fw={600}>{format(result.expenseTarget)}</Text>
        </Stack>
        <Stack gap={2}>
          <Text size="xs" c="dimmed">{t("budgetCalculatorIncomeTotal")}</Text>
          <Text fw={600}>{format(result.incomeTarget)}</Text>
        </Stack>
      </SimpleGrid>
      {mode === "journal" && result.expenseReferenceTarget !== null && result.expenseReferenceTarget !== 0 && (
        <Text size="sm">{t("budgetCalculatorReferenceSplit")
          .replace("{active}", format(result.expenseActiveTarget ?? 0))
          .replace("{reference}", format(result.expenseReferenceTarget))}</Text>
      )}
      <Text size="xs" c="dimmed">{t("budgetCalculatorSignHint")}</Text>
      {rows.length > 0 && <ScrollArea>
        <Table withTableBorder miw={360}>
          <Table.Thead><Table.Tr>
            <Table.Th>{t("budgetCategoryLabel")}</Table.Th>
            <Table.Th className="currency-cell">{t("budgetCalculatorExpenseTotal")}</Table.Th>
            <Table.Th className="currency-cell">{t("budgetCalculatorIncomeTotal")}</Table.Th>
          </Table.Tr></Table.Thead>
          <Table.Tbody>{rows.map(category => <Table.Tr key={category.id}>
            <Table.Td>{category.name}</Table.Td>
            <Table.Td className="currency-cell">{format(result.expense[category.id] ?? 0)}</Table.Td>
            <Table.Td className="currency-cell">{format(result.income[category.id] ?? 0)}</Table.Td>
          </Table.Tr>)}</Table.Tbody>
        </Table>
      </ScrollArea>}
      {(result.expenseUnassigned !== 0 || result.incomeUnassigned !== 0) && <Alert color="yellow">
        {t("budgetCalculatorUnassigned")
          .replace("{expense}", format(result.expenseUnassigned))
          .replace("{income}", format(result.incomeUnassigned))}
      </Alert>}
      {incomeBlocked && <Alert color="yellow">{t("incomeTransferEditConflict")}</Alert>}
      <Group justify="flex-end">
        <Button type="button" variant="default" onClick={onClose}>{t("cancel")}</Button>
        <Button type="button" disabled={!result.canApply || incomeBlocked} onClick={() => onApply({
          ...(mode === "journal" || account?.type === "expense" ? { expense: { ...result.expense } } : {}),
          ...(mode === "journal" || account?.type === "income" ? { income: { ...result.income } } : {}),
        })}>{t("budgetCalculatorApply")}</Button>
      </Group>
    </Stack>
  );
}
