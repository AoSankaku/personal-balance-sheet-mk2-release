import { Alert, Group, Text } from "@mantine/core";
import { useSyncExternalStore } from "react";
import { useLang, toIntlLocale, type Locale } from "../i18n";
import {
  clearD1LimitNotice,
  getD1LimitNoticeSnapshot,
  subscribeD1LimitNotice,
} from "../lib/d1LimitNotice";

function formatRetryAt(retryAt: string, locale: Locale) {
  return new Intl.DateTimeFormat(toIntlLocale(locale), {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(retryAt));
}

export function D1LimitAlert() {
  const { t, locale } = useLang();
  const notice = useSyncExternalStore(
    subscribeD1LimitNotice,
    getD1LimitNoticeSnapshot,
    getD1LimitNoticeSnapshot,
  );

  if (!notice) return null;

  const message =
    notice.limit_type === "daily_read"
      ? t("d1DailyReadLimitMessage")
      : notice.limit_type === "daily_write"
        ? t("d1DailyWriteLimitMessage")
        : t("d1RequestLimitMessage");

  return (
    <Alert
      color="orange"
      title={t("d1LimitTitle")}
      withCloseButton
      closeButtonLabel={t("statusDismiss")}
      onClose={clearD1LimitNotice}
      mt="md"
      role="alert"
    >
      <Group align="flex-start" gap="xs" wrap="wrap">
        <Text size="sm">{message}</Text>
        {notice.retry_at && (
          <Text size="sm">
            {t("d1LimitRetryAt").replace(
              "{date}",
              formatRetryAt(notice.retry_at, locale),
            )}
          </Text>
        )}
        <Text size="sm">{t("d1LimitSaveWarning")}</Text>
      </Group>
    </Alert>
  );
}
