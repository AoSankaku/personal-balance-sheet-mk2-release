import {
  Alert,
  Button,
  Group,
  Paper,
  Skeleton,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { usePrivacy } from "../context/PrivacyContext";
import { useDepreciationBudget } from "../context/DepreciationBudgetContext";
import { useLang } from "../i18n";
import { formatCurrency } from "../lib/numberFormat";

export function DepreciationBudgetSchedulesSection() {
  const { t, locale } = useLang();
  const { privacyMode } = usePrivacy();
  const { schedules, loading, error, refresh, openRepair } =
    useDepreciationBudget();

  if (privacyMode) return null;

  return (
    <Paper withBorder p="md" radius="md">
      <Stack gap="sm">
        <div>
          <Title order={4}>{t("depreciationBudgetSchedulesTitle")}</Title>
          <Text size="sm" c="dimmed" mt={4}>
            {t("depreciationBudgetSchedulesHint")}
          </Text>
        </div>
        {loading && schedules.length === 0 ? (
          <Stack gap="xs" role="status" aria-busy="true">
            <Skeleton height={52} />
          </Stack>
        ) : error ? (
          <Alert color="red" title={error}>
            <Button size="xs" variant="light" onClick={() => void refresh()}>
              {t("depreciationBudgetSchedulesRetry")}
            </Button>
          </Alert>
        ) : schedules.length === 0 ? (
          <Text size="sm" c="dimmed">
            {t("depreciationBudgetSchedulesEmpty")}
          </Text>
        ) : (
          <Stack gap="xs">
            {schedules.map((schedule) => {
              const { budget } = schedule;
              const status =
                budget.status === "unset" || budget.method == null
                  ? t("depreciationBudgetUnset")
                  : budget.status === "active"
                    ? t("depreciationBudgetStatusActive")
                    : budget.status === "completed"
                      ? t("depreciationBudgetStatusCompleted")
                      : t("depreciationBudgetStatusEnded");
              const isConfigured =
                budget.status !== "unset" && budget.method != null;
              return (
                <Paper key={schedule.id} withBorder p="sm" radius="sm">
                  <Group justify="space-between" align="center" gap="md" wrap="wrap">
                    <Stack gap={3} style={{ flex: 1, minWidth: 180 }}>
                      <Text size="sm" fw={600}>
                        {schedule.description}
                      </Text>
                      <Text size="xs" c="dimmed">
                        {status}
                        {isConfigured && (
                          <>
                            {" · "}
                            {t("depreciationBudgetReimbursedLabel")} {" "}
                            {formatCurrency(
                              budget.reimbursed_amount,
                              locale,
                              budget.currency,
                            )}{" "}
                            · {t("depreciationBudgetRemainingLabel")} {" "}
                            {formatCurrency(
                              budget.remaining_amount,
                              locale,
                              budget.currency,
                            )}{" "}
                            ({budget.currency})
                          </>
                        )}
                      </Text>
                    </Stack>
                    <Button
                      size="xs"
                      variant="light"
                      onClick={() => openRepair(schedule.id)}
                    >
                      {t("depreciationBudgetRepairButton")}
                    </Button>
                  </Group>
                </Paper>
              );
            })}
          </Stack>
        )}
      </Stack>
    </Paper>
  );
}
