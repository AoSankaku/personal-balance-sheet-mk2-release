import {
  Box,
  Button,
  Group,
  Paper,
  Stack,
  Text,
  ThemeIcon,
  Title,
} from "@mantine/core";
import { IconChevronRight, IconListCheck } from "@tabler/icons-react";
import { Link } from "react-router-dom";
import { TaskList } from "../components/TaskList";
import { useTaskCollection } from "../hooks/useTaskCollection";
import { useLang } from "../i18n";

export default function TasksPage() {
  const { t } = useLang();
  const tasks = useTaskCollection();

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-start" wrap="wrap">
        <Group align="flex-start" wrap="nowrap">
          <ThemeIcon variant="light" color="blue" radius="xl" size={42}>
            <IconListCheck size={22} aria-hidden="true" />
          </ThemeIcon>
          <Box>
            <Title order={2}>{t("tasks")}</Title>
            <Text c="dimmed" size="sm" mt={4}>
              {t("tasksPageHint")}
            </Text>
          </Box>
        </Group>
        {tasks.incomeTransferTasks.length > 0 && (
          <Button
            component={Link}
            to="/tasks/income-transfer"
            variant="light"
            rightSection={<IconChevronRight size={16} aria-hidden="true" />}
          >
            {t("incomeTransferOpenTasksPage").replace(
              "{count}",
              String(tasks.incomeTransferTasks.length),
            )}
          </Button>
        )}
      </Group>

      <Paper withBorder p="sm">
        <TaskList tasks={tasks} />
      </Paper>
    </Stack>
  );
}
