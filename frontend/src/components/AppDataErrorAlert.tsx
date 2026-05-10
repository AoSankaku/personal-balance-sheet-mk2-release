import { Alert, Button, Group, Stack, Text } from "@mantine/core";
import { IconRefresh } from "@tabler/icons-react";
import { useAppData } from "../context/AppDataContext";
import { useLang } from "../i18n";
import { tForLocale, type Locale, type TranslationKey } from "../i18n";

interface AppDataErrorAlertProps {
  error: string;
}

function multilingual(key: TranslationKey, locale: Locale) {
  const secondaryLocale: Locale =
    locale === "ja" ? "en" : locale === "en" ? "ja" : "en";
  const primary = tForLocale(key, locale);
  const secondary = tForLocale(key, secondaryLocale);
  return primary === secondary ? primary : `${primary} / ${secondary}`;
}

function formatErrorMessage(error: string, locale: Locale) {
  const normalized = error.trim().toLowerCase();
  const internalServerError = tForLocale("internalServerError", "en").toLowerCase();
  if (normalized === internalServerError) {
    return multilingual("internalServerError", locale);
  }
  return error;
}

export function AppDataErrorAlert({ error }: AppDataErrorAlertProps) {
  const { locale } = useLang();
  const { loading, refresh } = useAppData();
  const title = multilingual("errorTitle", locale);
  const reloadLabel = multilingual("reload", locale);
  const message = formatErrorMessage(error, locale);

  return (
    <Alert color="red" title={title} mt="md">
      <Stack gap="sm" align="flex-start">
        <Text size="sm">{message}</Text>
        <Group>
          <Button
            size="xs"
            color="red"
            variant="light"
            leftSection={<IconRefresh size={14} />}
            loading={loading}
            onClick={() => refresh()}
          >
            {reloadLabel}
          </Button>
        </Group>
      </Stack>
    </Alert>
  );
}
