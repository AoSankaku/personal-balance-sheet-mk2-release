import { Alert, Button, Group, Text } from "@mantine/core";
import { IconRefreshAlert } from "@tabler/icons-react";
import { useState, useSyncExternalStore } from "react";
import {
  getReloadPromptSnapshot,
  subscribeReloadPrompt,
} from "../lib/reloadPrompt";
import { useLang } from "../i18n";
import { reloadAppWithLatestServiceWorker } from "../lib/pwaUpdate";

export function HardReloadPrompt() {
  const { t } = useLang();
  const [updating, setUpdating] = useState(false);
  const item = useSyncExternalStore(
    subscribeReloadPrompt,
    getReloadPromptSnapshot,
    getReloadPromptSnapshot,
  );

  if (!item) return null;

  const isAccess = item.reason === "cloudflare-access-session";
  const title = isAccess
    ? t("hardReloadAccessTitle")
    : t("hardReloadVersionTitle");
  const message = isAccess
    ? t("hardReloadAccessMessage")
    : item.latestVersion
      ? `${t("hardReloadVersionMessage")} (${item.currentVersion ?? "?"} -> ${
          item.latestVersion
        })`
      : t("hardReloadVersionMessage");

  async function reload() {
    if (isAccess) {
      window.location.reload();
      return;
    }

    setUpdating(true);
    await reloadAppWithLatestServiceWorker();
    setUpdating(false);
  }

  return (
    <Alert
      color="orange"
      icon={<IconRefreshAlert size={20} />}
      radius="md"
      variant="filled"
      title={title}
      style={{
        position: "fixed",
        left: "50%",
        top: "72px",
        transform: "translateX(-50%)",
        width: "min(720px, calc(100vw - 24px))",
        zIndex: 500,
        boxShadow: "0 12px 32px rgba(0, 0, 0, 0.22)",
      }}
    >
      <Group justify="space-between" gap="sm" align="center">
        <Text size="sm" style={{ flex: 1 }}>
          {message}
        </Text>
        <Button
          color="dark"
          variant="white"
          size="xs"
          loading={updating}
          onClick={reload}
        >
          {t("hardReloadAction")}
        </Button>
      </Group>
    </Alert>
  );
}
