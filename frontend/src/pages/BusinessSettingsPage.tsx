import {
  Anchor,
  Collapse,
  Group,
  Select,
  Skeleton,
  Stack,
  Switch,
  Text,
  Title,
} from "@mantine/core";
import { IconBriefcase } from "@tabler/icons-react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { useLang } from "../i18n";
import { useAppData } from "../context/AppDataContext";
import { AppDataErrorAlert } from "../components/AppDataErrorAlert";
import {
  isUserSelectableAccount,
  toAccountSelectOption,
} from "../lib/accountUtils";

export default function BusinessSettingsPage() {
  const { t } = useLang();
  const {
    accounts,
    budgetCategories,
    budgetSettings,
    loading,
    error,
    refreshBudgetSettings,
  } = useAppData();

  if (loading) {
    return (
      <Stack gap="lg">
        <Skeleton height={24} width={200} radius="sm" />
        <Skeleton height={40} radius="sm" />
        <Skeleton height={40} radius="sm" />
      </Stack>
    );
  }

  if (error) {
    return <AppDataErrorAlert error={error} />;
  }

  return (
    <Stack gap="xl">
      <Group gap="xs">
        <Anchor component={Link} to="/settings" size="sm" c="dimmed">
          {t("settingsSubpageBack")}
        </Anchor>
      </Group>

      <Stack gap="sm">
        <Group gap="xs">
          <IconBriefcase size={22} />
          <Title order={3}>{t("businessOwnerSettingsTitle")}</Title>
        </Group>
        <Text size="sm" c="dimmed">
          {t("businessOwnerSettingsHint")}
        </Text>
      </Stack>

      <Stack gap="xs">
        <Switch
          label={t("isBusinessOwner")}
          checked={budgetSettings?.is_business_owner ?? false}
          onChange={(e) => {
            void api.budget
              .updateSettings({ is_business_owner: e.currentTarget.checked })
              .then(() => void refreshBudgetSettings());
          }}
        />
        <Collapse in={budgetSettings?.is_business_owner ?? false}>
          <Stack gap="xs" pt="xs">
            <Select
              size="sm"
              w={280}
              label={t("businessAdvanceAccountLabel")}
              description={t("businessAdvanceAccountDesc")}
              placeholder={t("selectAccount")}
              clearable
              value={
                budgetSettings?.business_advance_account_id != null
                  ? String(budgetSettings.business_advance_account_id)
                  : null
              }
              onChange={(v) => {
                void api.budget
                  .updateSettings({
                    business_advance_account_id: v ? Number(v) : null,
                  })
                  .then(() => void refreshBudgetSettings());
              }}
              data={accounts
                .filter((a) => a.type === "asset" && isUserSelectableAccount(a))
                .map((a) => toAccountSelectOption(a, t))}
            />
            <Select
              size="sm"
              w={280}
              label={t("businessLossAccountLabel")}
              description={t("businessLossAccountDesc")}
              placeholder={t("selectAccount")}
              clearable
              value={
                budgetSettings?.business_loss_account_id != null
                  ? String(budgetSettings.business_loss_account_id)
                  : null
              }
              onChange={(v) => {
                void api.budget
                  .updateSettings({
                    business_loss_account_id: v ? Number(v) : null,
                  })
                  .then(() => void refreshBudgetSettings());
              }}
              data={accounts
                .filter(
                  (a) => a.type === "expense" && isUserSelectableAccount(a),
                )
                .map((a) => toAccountSelectOption(a, t))}
            />
            <Select
              size="sm"
              w={280}
              label={t("businessAdvanceBudgetCategoryLabel")}
              description={t("businessAdvanceBudgetCategoryDesc")}
              placeholder={t("selectAccount")}
              clearable
              value={
                budgetSettings?.business_advance_budget_category_id != null
                  ? String(
                      budgetSettings.business_advance_budget_category_id,
                    )
                  : null
              }
              onChange={(v) => {
                void api.budget
                  .updateSettings({
                    business_advance_budget_category_id: v
                      ? Number(v)
                      : null,
                  })
                  .then(() => void refreshBudgetSettings());
              }}
              data={budgetCategories.map((c) => ({
                value: String(c.id),
                label: c.name,
              }))}
            />
          </Stack>
        </Collapse>
      </Stack>
    </Stack>
  );
}
