import { useEffect, useMemo, useState } from "react";
import {
  Badge,
  Button,
  Group,
  NumberInput,
  Paper,
  Select,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { IconCoins } from "@tabler/icons-react";
import { api } from "../api/client";
import { useAppData } from "../context/AppDataContext";
import { useLang } from "../i18n";
import { buildAccountOptionsByCategory, renderAccountOption } from "../lib/accountSelect";
import { showFeedback } from "../lib/feedback";
import { buildInterestTransferThresholds } from "../lib/interestIncome";

function normalizedCurrency(currency: string | null | undefined) {
  return (currency || "JPY").toUpperCase();
}

function defaultTransferThreshold(currency: string) {
  return currency === "JPY" ? 1000 : 0;
}

export function InterestIncomeSettings({ disabled = false }: { disabled?: boolean }) {
  const { t } = useLang();
  const {
    accounts,
    budgetCategories,
    budgetSettings,
    displayCurrency,
    enabledCurrencies,
    refreshBudgetSettings,
  } = useAppData();
  const savedRule = budgetSettings?.interest_income_rule ?? null;
  const [incomeAccountId, setIncomeAccountId] = useState<string | null>(null);
  const [budgetCategoryId, setBudgetCategoryId] = useState<string | null>(null);
  const [thresholds, setThresholds] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!budgetSettings) return;
    setIncomeAccountId(
      savedRule ? String(savedRule.income_account_id) : null,
    );
    setBudgetCategoryId(
      savedRule ? String(savedRule.budget_category_id) : null,
    );
    setThresholds(savedRule?.transfer_thresholds ?? {});
  }, [budgetSettings, savedRule]);

  const currency = normalizedCurrency(displayCurrency);
  const currencyPrecision =
    enabledCurrencies.find((item) => item.code.toUpperCase() === currency)
      ?.decimal_places ?? 2;
  const threshold =
    thresholds[currency] ?? defaultTransferThreshold(currency);
  const incomeAccountOptions = useMemo(
    () =>
      buildAccountOptionsByCategory(
        accounts.filter((account) => account.type === "income"),
        t,
      ),
    [accounts, t],
  );
  const categoryOptions = useMemo(
    () =>
      budgetCategories
        .filter((category) => !category.is_archived)
        .map((category) => ({
          value: String(category.id),
          label: category.name,
        })),
    [budgetCategories],
  );

  async function saveRule() {
    if (!budgetSettings || !incomeAccountId || !budgetCategoryId || saving) return;
    setSaving(true);
    const transferThresholds = buildInterestTransferThresholds(thresholds, enabledCurrencies, currency, threshold);
    try {
      const updated = await api.budget.updateSettings({
        interest_income_rule: {
          income_account_id: Number(incomeAccountId),
          budget_category_id: Number(budgetCategoryId),
          transfer_thresholds: transferThresholds,
        },
      });
      setThresholds(updated.interest_income_rule?.transfer_thresholds ?? {});
      void refreshBudgetSettings();
      showFeedback({ message: t("interestIncomeSaved"), color: "teal" });
    } catch {
      showFeedback({ message: t("interestIncomeSaveFailed"), color: "red" });
    } finally {
      setSaving(false);
    }
  }

  async function clearRule() {
    if (!savedRule || saving) return;
    setSaving(true);
    try {
      await api.budget.updateSettings({ interest_income_rule: null });
      setIncomeAccountId(null);
      setBudgetCategoryId(null);
      setThresholds({});
      void refreshBudgetSettings();
      showFeedback({ message: t("interestIncomeRuleDisabled"), color: "teal" });
    } catch {
      showFeedback({ message: t("interestIncomeSaveFailed"), color: "red" });
    } finally {
      setSaving(false);
    }
  }

  const controlsDisabled = disabled || saving || !budgetSettings;

  return (
    <Paper withBorder p="sm">
      <Stack gap="sm">
        <Group justify="space-between" align="flex-start" wrap="wrap">
          <Group gap="xs" wrap="nowrap">
            <IconCoins size={18} />
            <Title order={5}>{t("interestIncomeSettingsTitle")}</Title>
          </Group>
          <Badge color={savedRule ? "teal" : "gray"} variant="light">
            {t(
              savedRule
                ? "interestIncomeRuleStatusEnabled"
                : "interestIncomeRuleStatusDisabled",
            )}
          </Badge>
        </Group>
        <Text size="sm" c="dimmed">
          {t("interestIncomeSettingsDescription")}
        </Text>

        <Select
          label={t("interestIncomeAccountLabel")}
          placeholder={t("selectAccount")}
          data={incomeAccountOptions}
          value={incomeAccountId}
          onChange={setIncomeAccountId}
          searchable
          renderOption={renderAccountOption as never}
          disabled={controlsDisabled}
        />
        <Select
          label={t("interestIncomeBudgetLabel")}
          placeholder={t("budgetCategoryLabel")}
          data={categoryOptions}
          value={budgetCategoryId}
          onChange={setBudgetCategoryId}
          searchable
          disabled={controlsDisabled}
        />
        <NumberInput
          label={`${t("interestIncomeThresholdLabel")} (${currency})`}
          description={t("interestIncomeThresholdHint")}
          value={threshold}
          onChange={(value) => {
            const next = typeof value === "number" ? value : Number(value);
            if (Number.isFinite(next)) {
              setThresholds((current) => ({ ...current, [currency]: next }));
            }
          }}
          min={0}
          step={10 ** -currencyPrecision}
          decimalScale={currencyPrecision}
          disabled={controlsDisabled}
        />

        <Group gap="xs" justify="flex-end" wrap="wrap">
          {savedRule && (
            <Button
              variant="default"
              color="red"
              onClick={() => void clearRule()}
              loading={saving}
              disabled={disabled}
            >
              {t("interestIncomeDisable")}
            </Button>
          )}
          <Button
            onClick={() => void saveRule()}
            loading={saving}
            disabled={controlsDisabled || !incomeAccountId || !budgetCategoryId}
          >
            {t("interestIncomeSave")}
          </Button>
        </Group>
      </Stack>
    </Paper>
  );
}
