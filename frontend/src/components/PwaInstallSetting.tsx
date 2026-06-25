import { Button } from "@mantine/core";
import { IconDownload } from "@tabler/icons-react";
import { useState, useSyncExternalStore } from "react";
import { useLang } from "../i18n";
import {
  getPwaInstallSnapshot,
  requestPwaInstall,
  subscribePwaInstall,
} from "../lib/pwaInstall";

export function PwaInstallSetting() {
  const { t } = useLang();
  const available = useSyncExternalStore(
    subscribePwaInstall,
    getPwaInstallSnapshot,
    () => false,
  );
  const [installing, setInstalling] = useState(false);

  if (!available) return null;

  async function install() {
    setInstalling(true);
    try {
      await requestPwaInstall();
    } finally {
      setInstalling(false);
    }
  }

  return (
    <Button
      variant="default"
      w="fit-content"
      leftSection={<IconDownload size={16} />}
      loading={installing}
      onClick={install}
    >
      {t("pwaInstallButton")}
    </Button>
  );
}
