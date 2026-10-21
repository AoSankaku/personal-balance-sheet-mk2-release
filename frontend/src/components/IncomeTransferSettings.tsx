import { useEffect, useState } from "react";
import {
  Badge,
  Button,
  Group,
  NumberInput,
  Paper,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { IconArrowsExchange } from "@tabler/icons-react";
import { api } from "../api/client";
import { useAppData } from "../context/AppDataContext";
import { useLang } from "../i18n";
import { showFeedback } from "../lib/feedback";
import { buildIncomeTransferThresholds } from "../lib/incomeTransferScheduling";

function normalizedCurrency(currency: string | null | undefined) {
  return (currency || "JPY").toUpperCase();
}

export function IncomeTransferSettings({ disabled = false }: { disabled?: boolean }) {
  const { t } = useLang();
  const {
    budgetSettings,
    displayCurrency,
    enabledCurrencies,
    refreshBudgetSettings,
  } = useAppData();
  const savedSettings = budgetSettings?.income_transfer_settings ?? null;
  const [thresholds, setThresholds] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!budgetSettings) return;
    setThresholds(savedSettings?.transfer_thresholds ?? {});
  }, [budgetSettings, savedSettings]);

  const currency = normalizedCurrency(displayCurrency);
  const currencyPrecision =
    enabledCurrencies.find((item) => item.code.toUpperCase() === currency)
      ?.decimal_places ?? 2;
  const threshold = thresholds[currency] ?? 0;

  async function saveSettings() {
    if (!budgetSettings || saving) return;
    setSaving(true);
    const transferThresholds = buildIncomeTransferThresholds(
      thresholds,
      enabledCurrencies,
      currency,
      threshold,
    );
    try {
      const updated = await api.budget.updateSettings({
        income_transfer_settings: { transfer_thresholds: transferThresholds },
      });
      setThresholds(
        updated.income_transfer_settings?.transfer_thresholds ?? {},
      );
      void refreshBudgetSettings();
      showFeedback({ message: t("incomeTransferSettingsSaved"), color: "teal" });
    } catch {
      showFeedback({ message: t("incomeTransferSettingsSaveFailed"), color: "red" });
    } finally {
      setSaving(false);
    }
  }

  async function disableSettings() {
    if (!savedSettings || saving) return;
    setSaving(true);
    try {
      await api.budget.updateSettings({ income_transfer_settings: null });
      setThresholds({});
      void refreshBudgetSettings();
      showFeedback({ message: t("incomeTransferSettingsDisabled"), color: "teal" });
    } catch {
      showFeedback({ message: t("incomeTransferSettingsSaveFailed"), color: "red" });
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
            <IconArrowsExchange size={18} />
            <Title order={5}>{t("incomeTransferSettingsTitle")}</Title>
          </Group>
          <Badge color={savedSettings ? "teal" : "gray"} variant="light">
            {t(
              savedSettings
                ? "incomeTransferSettingsStatusEnabled"
                : "incomeTransferSettingsStatusDisabled",
            )}
          </Badge>
        </Group>
        <Text size="sm" c="dimmed">
          {t("incomeTransferSettingsDescription")}
        </Text>

        <NumberInput
          label={`${t("incomeTransferSettingsThresholdLabel")} (${currency})`}
          description={t("incomeTransferSettingsThresholdHint")}
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
          {savedSettings && (
            <Button
              variant="default"
              color="red"
              onClick={() => void disableSettings()}
              loading={saving}
              disabled={disabled}
            >
              {t("incomeTransferSettingsDisable")}
            </Button>
          )}
          <Button
            onClick={() => void saveSettings()}
            loading={saving}
            disabled={controlsDisabled}
          >
            {t("incomeTransferSettingsSave")}
          </Button>
        </Group>
      </Stack>
    </Paper>
  );
}
