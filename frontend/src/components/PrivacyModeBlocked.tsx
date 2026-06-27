import { Alert, Anchor, Button, Group, Stack, Text, Title } from "@mantine/core";
import { IconLock } from "@tabler/icons-react";
import { Link } from "react-router-dom";
import { useLang } from "../i18n";

export function PrivacyModeBlocked() {
  const { t } = useLang();
  return (
    <Stack gap="md">
      <Group gap="xs">
        <IconLock size={18} />
        <Title order={4}>{t("privacyModeBlockedTitle")}</Title>
      </Group>
      <Alert color="gray" variant="light">
        <Text size="sm">{t("privacyModeBlockedMessage")}</Text>
      </Alert>
      <Group gap="xs">
        <Button component={Link} to="/settings" variant="default">
          {t("navSettings")}
        </Button>
        <Anchor component={Link} to="/settings/guides" size="sm">
          {t("settingsNavGuidesTitle")}
        </Anchor>
      </Group>
    </Stack>
  );
}
