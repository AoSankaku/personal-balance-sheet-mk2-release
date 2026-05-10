import {
  Button,
  Group,
  Modal,
  PasswordInput,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { useState } from "react";
import { api } from "../api/client";

interface Props {
  opened: boolean;
  onClose: () => void;
  onSaved: () => void;
  /** Existing credential id for deletion, if already configured */
  existingId?: number;
  /** Existing api_key to pre-fill, if already configured */
  existingApiKey?: string;
}

export function ExchangeCredentialModal({
  opened,
  onClose,
  onSaved,
  existingId,
  existingApiKey,
}: Props) {
  const [apiKey, setApiKey] = useState(existingApiKey ?? "");
  const [apiSecret, setApiSecret] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleClose() {
    setApiKey(existingApiKey ?? "");
    setApiSecret("");
    setError(null);
    onClose();
  }

  async function handleSave() {
    if (!apiKey.trim() || !apiSecret.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.exchangeCredentials.upsert({
        exchange: "binance",
        api_key: apiKey.trim(),
        api_secret: apiSecret.trim(),
      });
      onSaved();
      handleClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save credentials");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!existingId) return;
    setDeleting(true);
    setError(null);
    try {
      await api.exchangeCredentials.delete(existingId);
      onSaved();
      handleClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to remove credentials");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Modal
      opened={opened}
      onClose={handleClose}
      title="Binance API Credentials"
      centered
    >
      <Stack>
        <Text size="sm" c="dimmed">
          Enter a read-only API key from your Binance account. The secret is
          stored in the database and never returned after saving.
        </Text>

        <TextInput
          label="API Key"
          placeholder="Paste your Binance API key"
          value={apiKey}
          onChange={(e) => setApiKey(e.currentTarget.value)}
        />

        <PasswordInput
          label="API Secret"
          placeholder={existingId ? "Enter new secret to update" : "Paste your Binance API secret"}
          value={apiSecret}
          onChange={(e) => setApiSecret(e.currentTarget.value)}
        />

        {error && (
          <Text size="sm" c="red">
            {error}
          </Text>
        )}

        <Group justify="space-between">
          {existingId && (
            <Button
              variant="subtle"
              color="red"
              size="sm"
              loading={deleting}
              onClick={handleDelete}
            >
              Remove
            </Button>
          )}
          <Group ml="auto">
            <Button variant="default" onClick={handleClose}>
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              loading={submitting}
              disabled={!apiKey.trim() || !apiSecret.trim()}
            >
              Save
            </Button>
          </Group>
        </Group>
      </Stack>
    </Modal>
  );
}
