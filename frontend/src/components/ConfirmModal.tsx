import { Button, Group, Modal, Text } from "@mantine/core";
import { useLang } from "../i18n";

interface Props {
  opened: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmLabel?: string;
  confirmColor?: string;
}

export function ConfirmModal({
  opened,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel,
  confirmColor = "red",
}: Props) {
  const { t } = useLang();

  function handleConfirm() {
    onConfirm();
    onClose();
  }

  return (
    <Modal opened={opened} onClose={onClose} title={title} size="sm" centered>
      <Text size="sm">{message}</Text>
      <Group justify="flex-end" mt="md">
        <Button variant="default" onClick={onClose}>
          {t("cancel")}
        </Button>
        <Button color={confirmColor} onClick={handleConfirm}>
          {confirmLabel ?? t("confirm")}
        </Button>
      </Group>
    </Modal>
  );
}
