import {
  ActionIcon,
  Anchor,
  Badge,
  Group,
  Skeleton,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { IconFileSpreadsheet, IconX } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { StoreAccountMapping } from "@balance-sheet/shared";
import { api } from "../api/client";
import { useLang } from "../i18n";
import { useAppData } from "../context/AppDataContext";
import { showFeedback } from "../lib/feedback";
import { AppDataErrorAlert } from "../components/AppDataErrorAlert";

export default function CsvSettingsPage() {
  const { t } = useLang();
  const { accounts, error } = useAppData();
  const [mappings, setMappings] = useState<StoreAccountMapping[]>([]);
  const [loadingMaps, setLoadingMaps] = useState(true);

  useEffect(() => {
    api.storeMappings
      .list()
      .then(setMappings)
      .catch(() => {})
      .finally(() => setLoadingMaps(false));
  }, []);

  async function handleDelete(id: number) {
    try {
      await api.storeMappings.delete(id);
      setMappings((prev) => prev.filter((m) => m.id !== id));
      showFeedback({ message: t("storeMappingDeleted"), color: "teal" });
    } catch {
      showFeedback({ message: t("deleteFailed"), color: "red" });
    }
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
          <IconFileSpreadsheet size={22} />
          <Title order={3}>{t("settingsNavCsvTitle")}</Title>
        </Group>
        <Text size="sm" c="dimmed">
          {t("settingsNavCsvDesc")}
        </Text>
      </Stack>

      <Stack gap="sm">
        <Title order={5}>{t("storeMappingsTitle")}</Title>
        <Text size="sm" c="dimmed">
          {t("storeMappingsDesc")}
        </Text>
        {loadingMaps ? (
          <Skeleton height={40} radius="sm" />
        ) : mappings.length === 0 ? (
          <Text size="sm" c="dimmed">
            {t("storeMappingsNoItems")}
          </Text>
        ) : (
          <Stack gap={6}>
            {mappings.map((m) => {
              const accName =
                m.account_name ??
                accounts.find((a) => a.id === m.account_id)?.name ??
                String(m.account_id);
              return (
                <Group key={m.id} justify="space-between" wrap="nowrap">
                  <Group gap="xs" style={{ flex: 1, minWidth: 0 }}>
                    <Text
                      size="sm"
                      style={{
                        flex: 1,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {m.store_name}
                    </Text>
                    <Text size="xs" c="dimmed">
                      →
                    </Text>
                    <Badge size="sm" variant="light" color="blue">
                      {accName}
                    </Badge>
                  </Group>
                  <ActionIcon
                    color="red"
                    variant="subtle"
                    size="sm"
                    onClick={() => void handleDelete(m.id)}
                  >
                    <IconX size={14} />
                  </ActionIcon>
                </Group>
              );
            })}
          </Stack>
        )}
      </Stack>
    </Stack>
  );
}
