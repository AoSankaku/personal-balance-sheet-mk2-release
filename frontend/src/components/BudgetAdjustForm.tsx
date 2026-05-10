import {
  Button,
  Checkbox,
  Group,
  NumberInput,
  Paper,
  Select,
  Stack,
  Text,
  Textarea,
} from "@mantine/core";
import { DateInput } from "@mantine/dates";
import dayjs from "dayjs";
import { useEffect, useState } from "react";
import { api } from "../api/client";
import { useLang } from "../i18n";
import { useAppData } from "../context/AppDataContext";
import { showFeedback } from "../lib/feedback";
import { formatCurrency } from "../lib/numberFormat";
import { normalizeBudgetAdjustmentNote } from "../lib/budgetAdjustmentNote";
import { budgetDraft, setBudgetDraft } from "../utils/inputDrafts";

export function BudgetAdjustForm({
  onDone,
  onReset,
}: {
  onDone: (result?: { categoryArchived?: boolean }) => void;
  onReset?: () => void;
}) {
  const { t, locale } = useLang();
  const {
    budgetCategories,
    allocatableToday,
    allocatableTotal,
    displayCurrency,
    displayCurrencySymbol: currencySymbol,
  } = useAppData();
  const [categoryId, setCategoryId] = useState<string | null>(
    budgetDraft?.categoryId ?? null,
  );
  const [amount, setAmount] = useState<number | string>(
    budgetDraft?.amount ?? 0,
  );
  const [date, setDate] = useState<Date>(budgetDraft?.date ?? new Date());
  const [note, setNote] = useState(budgetDraft?.note ?? "");
  const [resettingBudget, setResettingBudget] = useState(false);
  const [isBudgetReset, setIsBudgetReset] = useState(false);
  const [archiveAfterReset, setArchiveAfterReset] = useState(false);
  const selectedCurrency = displayCurrency || "JPY";
  const canSubmit =
    !!categoryId &&
    (Number(amount) !== 0 || (isBudgetReset && archiveAfterReset));

  useEffect(() => {
    setBudgetDraft({ categoryId, amount, date, note });
  }, [categoryId, amount, date, note]);

  const catOptions = budgetCategories.map((c) => ({
    value: String(c.id),
    label: c.name,
  }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const delta = Number(amount);
    if (!canSubmit) return;
    const yearMonth = dayjs(date).format("YYYY-MM");
    await api.budget.patchAdhocAllocation({
      budget_category_id: Number(categoryId),
      year_month: yearMonth,
      currency: selectedCurrency,
      adhoc_delta: delta,
      date: dayjs(date).format("YYYY-MM-DD"),
      note: normalizeBudgetAdjustmentNote(note),
      adjustment_type: isBudgetReset ? "reset" : "allocation",
      archive_category: isBudgetReset && archiveAfterReset,
    });
    showFeedback({ message: t("budgetAdjusted"), color: "teal" });
    setBudgetDraft(null);
    setCategoryId(null);
    setAmount(0);
    setNote("");
    setIsBudgetReset(false);
    setArchiveAfterReset(false);
    setDate(new Date());
    onDone({ categoryArchived: isBudgetReset && archiveAfterReset });
  }

  async function handleBrokenBudgetReset() {
    if (!categoryId) return;
    setResettingBudget(true);
    try {
      const yearMonth = dayjs(date).format("YYYY-MM");
      const asOf = dayjs(date).format("YYYY-MM-DD");
      const summary = await api.budget.summary(yearMonth, asOf, selectedCurrency);
      const categorySummary = summary.categories.find(
        (category) => category.category.id === Number(categoryId),
      );
      setAmount(categorySummary ? -categorySummary.available : 0);
      setIsBudgetReset(true);
    } finally {
      setResettingBudget(false);
    }
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)}>
      <Stack>
        <Paper withBorder px="md" py="xs" radius="md">
          <Group gap={6} align="center">
            <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
              {t("assignableMoneyLabel")}
            </Text>
            <Text size="sm" fw={700} c={allocatableToday >= 0 ? "teal" : "red"}>
              {formatCurrency(allocatableToday, locale, selectedCurrency)}
            </Text>
            <Text size="xs" c="dimmed">
              {t("assignableMoneyTodayLabel")}
            </Text>
            <Text size="sm" c={allocatableTotal >= 0 ? "dimmed" : "red"}>
              {formatCurrency(allocatableTotal, locale, selectedCurrency)}
            </Text>
            <Text size="xs" c="dimmed">
              {t("assignableMoneyTotalLabel")}
            </Text>
          </Group>
        </Paper>
        <DateInput
          label={t("budgetAdjustDateLabel")}
          required
          valueFormat="YYYY-MM-DD"
          value={date}
          onChange={(v) => setDate(v ?? new Date())}
        />
        <Select
          label={t("budgetCategoryLabel")}
          data={catOptions}
          value={categoryId}
          onChange={setCategoryId}
          searchable
          required
        />
        <NumberInput
          label={t("budgetAdjustAmountLabel")}
          value={amount}
          onChange={(value) => {
            setAmount(value);
            setIsBudgetReset(false);
            setArchiveAfterReset(false);
          }}
          prefix={currencySymbol}
          thousandSeparator=","
          allowNegative
        />
        <Textarea
          label={t("budgetAdjustNoteLabel")}
          placeholder={t("budgetAdjustNotePlaceholder")}
          value={note}
          onChange={(event) => setNote(event.currentTarget.value)}
          autosize
          minRows={2}
        />
        <Group justify="flex-start">
          <Button
            type="button"
            variant="light"
            color="red"
            disabled={!categoryId}
            loading={resettingBudget}
            onClick={() => void handleBrokenBudgetReset()}
          >
            {t("budgetResetToZeroButton")}
          </Button>
        </Group>
        {isBudgetReset && (
          <Checkbox
            label={t("archiveBudgetCategoryAfterReset")}
            checked={archiveAfterReset}
            onChange={(event) =>
              setArchiveAfterReset(event.currentTarget.checked)
            }
          />
        )}
        <Group justify="space-between">
          <Group>
            {onReset && (
              <Button variant="light" color="gray" onClick={onReset}>
                {t("reset")}
              </Button>
            )}
          </Group>
          <Button type="submit" disabled={!canSubmit}>
            {t("add")}
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
