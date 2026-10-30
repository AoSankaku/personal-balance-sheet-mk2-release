import { Anchor, Badge, Group, Paper, Stack, Text, Title } from "@mantine/core";
import { IconHistory } from "@tabler/icons-react";
import { useSyncExternalStore } from "react";
import { Link } from "react-router-dom";
import { useLang, type TranslationKey } from "../i18n";
import {
  getFeedbackHistorySnapshot,
  subscribeFeedbackHistory,
} from "../lib/feedback";
import {
  BOTTOM_NOTIFICATION_HISTORY_LIMIT,
  type BottomNotificationHistoryItem,
} from "../lib/bottomNotificationHistory";

const emptyHistory: readonly BottomNotificationHistoryItem[] = [];

function severityKey(color: BottomNotificationHistoryItem["color"]): TranslationKey {
  if (color === "red") return "notificationHistoryError";
  if (color === "orange" || color === "yellow") return "notificationHistoryWarning";
  if (color === "teal") return "notificationHistorySuccess";
  return "notificationHistoryInfo";
}

export function NotificationHistoryEntries({ items }: { items: readonly BottomNotificationHistoryItem[] }) {
  const { t, locale } = useLang();
  const dateTime = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "medium" });
  return (
    <Stack component="ol" gap="sm" m={0} p={0} aria-label={t("notificationHistoryTitle")} style={{ listStyle: "none" }}>
      {items.map(item => (
        <Paper component="li" key={item.id} withBorder p="md" radius="sm">
          <Stack gap="xs" style={{ overflowWrap: "anywhere" }}>
            <Group justify="space-between" gap="xs">
              <Badge color={item.color} variant="light">{t(severityKey(item.color))}</Badge>
              <Text component="time" dateTime={item.occurredAt} size="xs" c="dimmed">
                {dateTime.format(new Date(item.occurredAt))}
              </Text>
            </Group>
            <Text size="sm" fw={500} style={{ whiteSpace: "pre-wrap" }}>{item.message}</Text>
            <Stack gap={2}>
              <Text size="xs" c="dimmed">{t("notificationHistoryScreen")}</Text>
              <Anchor component={Link} to={item.path} size="sm">{item.screen}</Anchor>
              <Text size="xs" c="dimmed">{item.path}</Text>
            </Stack>
            {item.action && <Stack gap={2}>
              <Text size="xs" c="dimmed">{t("notificationHistoryAction")}</Text>
              <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>{item.action}</Text>
            </Stack>}
            {item.details && <Stack gap={2}>
              <Text size="xs" c="dimmed">{t("notificationHistoryDetails")}</Text>
              <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>{item.details}</Text>
            </Stack>}
          </Stack>
        </Paper>
      ))}
    </Stack>
  );
}

export default function BottomNotificationHistoryPage() {
  const { t } = useLang();
  const items = useSyncExternalStore(subscribeFeedbackHistory, getFeedbackHistorySnapshot, () => emptyHistory);
  return (
    <Stack gap="lg">
      <Anchor component={Link} to="/settings" size="sm" c="dimmed">{t("settingsSubpageBack")}</Anchor>
      <Stack gap="xs">
        <Group gap="xs">
          <IconHistory size={22} />
          <Title order={3}>{t("notificationHistoryTitle")}</Title>
        </Group>
        <Text size="sm" c="dimmed">
          {t("notificationHistoryDescription").replace("{limit}", String(BOTTOM_NOTIFICATION_HISTORY_LIMIT))}
        </Text>
        <Text size="sm">{t("notificationHistoryCount").replace("{count}", String(items.length))}</Text>
      </Stack>
      {items.length === 0
        ? <Paper withBorder p="lg" radius="sm"><Text size="sm" c="dimmed">{t("notificationHistoryEmpty")}</Text></Paper>
        : <NotificationHistoryEntries items={items} />}
    </Stack>
  );
}
