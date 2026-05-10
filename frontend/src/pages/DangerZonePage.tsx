import {
  Alert,
  Anchor,
  Box,
  Button,
  Group,
  Modal,
  Skeleton,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { IconAlertTriangle } from "@tabler/icons-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { useLang } from "../i18n";
import { useAppData } from "../context/AppDataContext";
import { showFeedback } from "../lib/feedback";
import { AppDataErrorAlert } from "../components/AppDataErrorAlert";

type DangerScope =
  | "ledger_this_month"
  | "ledger_this_year"
  | "ledger_all"
  | "accounts_all"
  | "budget_categories_all"
  | "all_data";

export default function DangerZonePage() {
  const { t, locale } = useLang();
  const { loading, error, refresh } = useAppData();

  const [dangerScope, setDangerScope] = useState<DangerScope | null>(null);
  const [dangerStep, setDangerStep] = useState<1 | 2>(1);
  const [dangerLoading, setDangerLoading] = useState(false);

  function openDanger(scope: DangerScope) {
    setDangerScope(scope);
    setDangerStep(1);
  }

  function closeDanger() {
    if (dangerLoading) return;
    setDangerScope(null);
    setDangerStep(1);
  }

  async function handleDangerConfirm() {
    if (dangerStep === 1) {
      setDangerStep(2);
      return;
    }
    if (!dangerScope) return;
    setDangerLoading(true);
    try {
      await api.admin.erase(dangerScope);
      if (dangerScope === "accounts_all" || dangerScope === "all_data") {
        await api.admin.seed(locale);
      }
      showFeedback({ message: t("dangerSuccessMsg"), color: "teal" });
      closeDanger();
      refresh();
    } catch {
      showFeedback({ message: t("dangerErrorMsg"), color: "red" });
    } finally {
      setDangerLoading(false);
    }
  }

  const dangerActions: {
    scope: DangerScope;
    labelKey: Parameters<typeof t>[0];
    descKey: Parameters<typeof t>[0];
  }[] = [
    {
      scope: "ledger_this_month",
      labelKey: "dangerEraseMonthLedger",
      descKey: "dangerEraseMonthLedgerDesc",
    },
    {
      scope: "ledger_this_year",
      labelKey: "dangerEraseYearLedger",
      descKey: "dangerEraseYearLedgerDesc",
    },
    {
      scope: "ledger_all",
      labelKey: "dangerEraseAllLedger",
      descKey: "dangerEraseAllLedgerDesc",
    },
    {
      scope: "accounts_all",
      labelKey: "dangerEraseAllAccounts",
      descKey: "dangerEraseAllAccountsDesc",
    },
    {
      scope: "budget_categories_all",
      labelKey: "dangerEraseAllBudgetCategories",
      descKey: "dangerEraseAllBudgetCategoriesDesc",
    },
    {
      scope: "all_data",
      labelKey: "dangerEraseAllData",
      descKey: "dangerEraseAllDataDesc",
    },
  ];

  if (loading) {
    return (
      <Stack gap="lg">
        <Skeleton height={24} width={200} radius="sm" />
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} height={60} radius="sm" />
        ))}
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
          <IconAlertTriangle size={22} color="var(--mantine-color-red-6)" />
          <Title order={3} c="red">
            {t("dangerZoneTitle")}
          </Title>
        </Group>
        <Text size="sm" c="dimmed">
          {t("dangerZoneDesc")}
        </Text>
        <Alert
          color="red"
          variant="light"
          icon={<IconAlertTriangle size={16} />}
          title={t("dangerAdminApiNoticeTitle")}
        >
          {t("dangerAdminApiNoticeBody")}
        </Alert>
      </Stack>

      <Box
        style={{
          border: "1px solid var(--mantine-color-red-4)",
          borderRadius: "var(--mantine-radius-sm)",
          padding: "var(--mantine-spacing-sm)",
        }}
      >
        <Stack gap="xs">
          {dangerActions.map(({ scope, labelKey, descKey }) => (
            <Group key={scope} justify="space-between" wrap="nowrap" gap="md">
              <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
                <Text size="sm" fw={500}>
                  {t(labelKey)}
                </Text>
                <Text size="xs" c="dimmed">
                  {t(descKey)}
                </Text>
              </Stack>
              <Button
                variant="outline"
                color="red"
                size="xs"
                style={{ flexShrink: 0 }}
                onClick={() => openDanger(scope)}
              >
                {t("deleteBudgetCategory")}
              </Button>
            </Group>
          ))}
        </Stack>
      </Box>

      {/* Step 1 Modal */}
      <Modal
        opened={dangerScope !== null && dangerStep === 1}
        onClose={closeDanger}
        title={
          <Group gap="xs">
            <IconAlertTriangle size={18} color="var(--mantine-color-red-6)" />
            <Text fw={600} c="red">
              {t("dangerConfirm1Title")}
            </Text>
          </Group>
        }
        centered
      >
        {dangerScope && (
          <Stack gap="md">
            <Text size="sm">{t("dangerConfirm1Body")}</Text>
            <Alert color="red" variant="light">
              <Text size="sm" fw={500}>
                {t(
                  dangerActions.find((a) => a.scope === dangerScope)
                    ?.labelKey ?? "dangerEraseAllData",
                )}
              </Text>
              <Text size="xs" mt={4}>
                {t(
                  dangerActions.find((a) => a.scope === dangerScope)?.descKey ??
                    "dangerEraseAllDataDesc",
                )}
              </Text>
            </Alert>
            <Group justify="flex-end">
              <Button variant="default" onClick={closeDanger}>
                {t("cancel")}
              </Button>
              <Button color="red" onClick={() => void handleDangerConfirm()}>
                {t("dangerProceedBtn")}
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>

      {/* Step 2 Modal */}
      <Modal
        opened={dangerScope !== null && dangerStep === 2}
        onClose={closeDanger}
        title={
          <Group gap="xs">
            <IconAlertTriangle size={18} color="var(--mantine-color-red-6)" />
            <Text fw={600} c="red">
              {t("dangerConfirm2Title")}
            </Text>
          </Group>
        }
        centered
      >
        {dangerScope && (
          <Stack gap="md">
            <Alert
              color="red"
              variant="filled"
              icon={<IconAlertTriangle size={16} />}
            >
              <Text size="sm" fw={500}>
                {t("dangerConfirm2Body")}
              </Text>
            </Alert>
            <Text size="sm" c="dimmed">
              {t(
                dangerActions.find((a) => a.scope === dangerScope)?.labelKey ??
                  "dangerEraseAllData",
              )}
            </Text>
            <Group justify="flex-end">
              <Button
                variant="default"
                onClick={closeDanger}
                disabled={dangerLoading}
              >
                {t("cancel")}
              </Button>
              <Button
                color="red"
                loading={dangerLoading}
                onClick={() => void handleDangerConfirm()}
              >
                {t("dangerConfirmFinalBtn")}
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </Stack>
  );
}
