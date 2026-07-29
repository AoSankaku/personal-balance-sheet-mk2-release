import {
  Box,
  Group,
  Stack,
  Text,
  ThemeIcon,
  UnstyledButton,
} from "@mantine/core";
import {
  IconAlertTriangle,
  IconChevronRight,
  IconScale,
} from "@tabler/icons-react";
import {
  useNavigate,
  type NavigateOptions,
  type To,
} from "react-router-dom";
import type { TaskCollection } from "../hooks/useTaskCollection";
import { formatTaskMonth } from "../hooks/useTaskCollection";
import { useLang } from "../i18n";
import { accountDisplayNameFromName } from "../lib/accountUtils";
import { formatJPY } from "../lib/numberFormat";
import "./TopNav.css";

interface TaskListProps {
  onNavigate?: () => void;
  tasks: TaskCollection;
}

export function TaskList({ onNavigate, tasks }: TaskListProps) {
  const { t, locale } = useLang();
  const navigate = useNavigate();
  const {
    budgetTask,
    creditCardImportTasks,
    creditCardWithdrawalRiskTasks,
    incomeTransferTasks,
    negativeAccountTasks,
    overdueLoanTasks,
    paydayTasks,
    pendingOfflineDrafts,
    totalCount,
    trialBalanceTask,
  } = tasks;

  function openTask(to: To, options?: NavigateOptions) {
    navigate(to, options);
    onNavigate?.();
  }

  if (totalCount === 0) {
    return (
      <Text size="sm" c="dimmed" ta="center" py="lg">
        {t("noTasks")}
      </Text>
    );
  }

  return (
    <Stack gap="sm">
      {pendingOfflineDrafts.length > 0 && (
        <Stack gap={4}>
          <Text className="task-menu__section-label">
            {t("taskOfflineDraftsSection")}
          </Text>
          {pendingOfflineDrafts.map((draft) => (
            <UnstyledButton
              key={draft.id}
              className="task-menu__item"
              onClick={() =>
                openTask("/input", {
                  state: { offlineDraftId: draft.id, tab: "simple" },
                })
              }
            >
              <Stack gap={2}>
                <Text size="sm">
                  {draft.draft.formValues.description ||
                    t("offlineDraftUntitled")}
                </Text>
                <Text size="xs" c="dimmed">
                  {t("taskOfflineDraftDetail")
                    .replace(
                      "{amount}",
                      String(draft.draft.formValues.amount ?? "-"),
                    )
                    .replace(
                      "{time}",
                      new Intl.DateTimeFormat(locale, {
                        dateStyle: "short",
                        timeStyle: "short",
                      }).format(new Date(draft.createdAt)),
                    )}
                </Text>
              </Stack>
            </UnstyledButton>
          ))}
        </Stack>
      )}

      {trialBalanceTask && (
        <Stack gap={4}>
          <Text className="task-menu__section-label">
            {t("taskTrialBalanceSection")}
          </Text>
          <UnstyledButton
            className="task-menu__item"
            onClick={() => openTask("/fs/tt?segment=actual")}
          >
            <Group align="flex-start" gap="sm" wrap="nowrap">
              <ThemeIcon color="violet" variant="light" radius="xl" size={34}>
                <IconScale size={18} aria-hidden="true" />
              </ThemeIcon>
              <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
                <Text size="sm" fw={600}>
                  {t("taskTrialBalanceSection")}
                </Text>
                <Text size="xs" c="dimmed">
                  {t("taskTrialBalanceDetail").replace(
                    "{date}",
                    new Intl.DateTimeFormat(locale, {
                      dateStyle: "medium",
                    }).format(
                      new Date(`${trialBalanceTask.scheduledDate}T00:00:00`),
                    ),
                  )}
                </Text>
              </Stack>
            </Group>
          </UnstyledButton>
        </Stack>
      )}

      {incomeTransferTasks.length > 0 && (
        <Stack gap={4}>
          <Text className="task-menu__section-label">
            {t("incomeTransferTasksTitle")}
          </Text>
          {incomeTransferTasks.map((task) => (
            <UnstyledButton
              key={task.key}
              className="task-menu__item"
              onClick={() => openTask("/tasks/income-transfer")}
            >
              <Stack gap={2}>
                <Text size="sm">
                  {task.requirements[0]?.from_account_name} →{" "}
                  {task.requirements[0]?.to_account_name}
                </Text>
                <Text size="xs" c="dimmed">
                  {formatJPY(task.amount, locale)}
                </Text>
              </Stack>
            </UnstyledButton>
          ))}
        </Stack>
      )}

      {budgetTask.show && (
        <UnstyledButton
          className="task-menu__item task-menu__budget-card"
          aria-label={`${t("taskBudgetNegativeTitle")}. ${t("taskBudgetNegative")}. ${t("taskBudgetNegativeAction")}`}
          onClick={() => openTask("/fs/tt?segment=budget&basis=today")}
        >
          <Group align="flex-start" gap="sm" wrap="nowrap">
            <ThemeIcon color="red" variant="light" radius="xl" size={34}>
              <IconAlertTriangle size={18} aria-hidden="true" />
            </ThemeIcon>
            <Stack gap={8} style={{ flex: 1, minWidth: 0 }}>
              <Box>
                <Text size="sm" fw={700}>
                  {t("taskBudgetNegativeTitle")}
                </Text>
                <Text size="xs" c="dimmed" lh={1.5} mt={2}>
                  {t("taskBudgetNegative")}
                </Text>
              </Box>
              <Group className="task-menu__metrics" gap="xs" wrap="nowrap">
                <Box className="task-menu__metric">
                  <Text size="xs" c="dimmed">
                    {t("assignableMoneyTodayLabel")}
                  </Text>
                  <Text
                    size="sm"
                    fw={700}
                    c={budgetTask.allocatableToday >= 0 ? "teal" : "red"}
                  >
                    {formatJPY(budgetTask.allocatableToday, locale)}
                  </Text>
                </Box>
                <Box className="task-menu__metric">
                  <Text size="xs" c="dimmed">
                    {t("assignableMoneyTotalLabel")}
                  </Text>
                  <Text
                    size="sm"
                    fw={700}
                    c={budgetTask.allocatableTotal >= 0 ? "teal" : "red"}
                  >
                    {formatJPY(budgetTask.allocatableTotal, locale)}
                  </Text>
                </Box>
              </Group>
              <Group gap={4} c="blue" wrap="nowrap">
                <Text size="xs" fw={700}>
                  {t("taskBudgetNegativeAction")}
                </Text>
                <IconChevronRight size={15} aria-hidden="true" />
              </Group>
            </Stack>
          </Group>
        </UnstyledButton>
      )}

      {paydayTasks.length > 0 && (
        <Stack gap={4}>
          <Text className="task-menu__section-label">
            {t("taskPaydayUnrecorded")}
          </Text>
          {paydayTasks.map((task) => (
            <UnstyledButton
              key={task.id}
              className="task-menu__item"
              onClick={() => openTask("/input")}
            >
              <Text size="sm">{task.message}</Text>
            </UnstyledButton>
          ))}
        </Stack>
      )}

      {creditCardImportTasks.length > 0 && (
        <Stack gap={4}>
          <Text className="task-menu__section-label">
            {t("taskCreditCardImportSection")}
          </Text>
          {creditCardImportTasks.map((task) => (
            <UnstyledButton
              key={task.id}
              className="task-menu__item"
              onClick={() => openTask("/input", { state: { tab: "csv" } })}
            >
              <Stack gap={2}>
                <Text size="sm">
                  {accountDisplayNameFromName(task.creditCardName, t)}
                </Text>
                <Text size="xs" c="dimmed">
                  {t("taskCreditCardImportDetail").replace(
                    "{month}",
                    formatTaskMonth(task.statementMonth, locale),
                  )}
                </Text>
              </Stack>
            </UnstyledButton>
          ))}
        </Stack>
      )}

      {creditCardWithdrawalRiskTasks.length > 0 && (
        <Stack gap={4}>
          <Text className="task-menu__section-label">
            {t("taskCreditCardWithdrawalRiskSection")}
          </Text>
          {creditCardWithdrawalRiskTasks.map((task) => (
            <UnstyledButton
              key={task.id}
              className="task-menu__item"
              onClick={() => openTask("/settings")}
            >
              <Stack gap={2}>
                <Group
                  className="task-menu__inline-row"
                  gap={8}
                  wrap="nowrap"
                >
                  <Text size="sm" style={{ flex: 1, minWidth: 0 }}>
                    {accountDisplayNameFromName(task.creditCardName, t)}
                  </Text>
                  <Text size="xs" c="red">
                    {formatJPY(task.combinedProjectedBalance, locale)}
                  </Text>
                </Group>
                <Text size="xs" c="dimmed">
                  {t("taskCreditCardWithdrawalRiskDetail")
                    .replace("{date}", task.withdrawalDate)
                    .replace(
                      "{account}",
                      accountDisplayNameFromName(
                        task.withdrawalAccountName,
                        t,
                      ),
                    )
                    .replace(
                      "{amount}",
                      formatJPY(task.combinedAmount, locale),
                    )}
                </Text>
              </Stack>
            </UnstyledButton>
          ))}
        </Stack>
      )}

      {overdueLoanTasks.length > 0 && (
        <Stack gap={4}>
          <Text className="task-menu__section-label">
            {t("taskLoanOverdueSection")}
          </Text>
          {overdueLoanTasks.map((task) => (
            <UnstyledButton
              key={task.id}
              className="task-menu__item"
              onClick={() => openTask("/fs/db")}
            >
              <Group
                className="task-menu__inline-row"
                gap={8}
                wrap="nowrap"
              >
                <Text size="sm" style={{ flex: 1, minWidth: 0 }}>
                  {task.message}
                </Text>
                <Text size="xs" c="orange">
                  {t("taskLoanOverdueDays").replace(
                    "{days}",
                    String(task.daysDiff),
                  )}
                </Text>
              </Group>
            </UnstyledButton>
          ))}
        </Stack>
      )}

      {negativeAccountTasks.length > 0 && (
        <Stack gap={4}>
          <Text className="task-menu__section-label">
            {t("taskAccountNegativeSection")}
          </Text>
          {negativeAccountTasks.map((task) => (
            <UnstyledButton
              key={task.id}
              className="task-menu__item"
              onClick={() => openTask("/settings")}
            >
              <Text size="sm" c="red">
                {task.message}
              </Text>
            </UnstyledButton>
          ))}
        </Stack>
      )}
    </Stack>
  );
}
