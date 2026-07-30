import { Box, Group, Stack, Text, ThemeIcon, Title } from "@mantine/core";
import { IconListCheck } from "@tabler/icons-react";
import { IncomeTransferTasks } from "../components/IncomeTransferTasks";
import { useLang } from "../i18n";

export default function IncomeTransferTasksPage() {
  const { t } = useLang();

  return (
    <Stack gap="lg">
      <Group align="flex-start" wrap="nowrap">
        <ThemeIcon variant="light" color="blue" radius="xl" size={42}>
          <IconListCheck size={22} aria-hidden="true" />
        </ThemeIcon>
        <Box>
          <Title order={2}>{t("incomeTransferTasksTitle")}</Title>
          <Text c="dimmed" size="sm" mt={4}>
            {t("incomeTransferTasksPageHint")}
          </Text>
        </Box>
      </Group>

      <IncomeTransferTasks showEmpty showTitle={false} />
    </Stack>
  );
}
