import { Button, Group, Modal, Stack, Text } from "@mantine/core";
import { useEffect, useMemo, useState } from "react";
import type { JournalEntry } from "@balance-sheet/shared";
import { api } from "../api/client";
import { useAppData } from "../context/AppDataContext";
import { usePrivacy } from "../context/PrivacyContext";
import { useLang } from "../i18n";
import { showFeedback } from "../lib/feedback";
import { ExpenseTagInput } from "./ExpenseTagInput";

/** A metadata-only editor also works for journals with managed accounting lines. */
export function ExpenseTagsModal({ entry, onClose, onSaved }: {
  entry: JournalEntry; onClose: () => void; onSaved: () => void | Promise<void>;
}) {
  const { t } = useLang();
  const { privacyMode } = usePrivacy();
  const { journal } = useAppData();
  const [tags, setTags] = useState(() => entry.expense_tags?.map(tag => tag.name) ?? []);
  const [catalog, setCatalog] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let active = true;
    void api.expenseTags.list().then(rows => { if (active) setCatalog(rows.map(tag => tag.name)); }).catch(() => {});
    return () => { active = false; };
  }, []);
  const options = useMemo(() => [...new Set([
    ...catalog, ...journal.flatMap(row => row.expense_tags?.map(tag => tag.name) ?? []),
  ])], [catalog, journal]);
  async function save() {
    if (privacyMode || saving) return;
    setSaving(true);
    try {
      await api.journal.updateExpenseTags(entry.id, tags);
      await onSaved();
      showFeedback({ message: t("expenseTagsSaved"), color: "teal" });
      onClose();
    } catch {
      showFeedback({ message: t("saveFailed"), color: "red" });
    } finally { setSaving(false); }
  }
  return <Modal opened={!privacyMode} onClose={onClose} title={t("editExpenseTags")} centered>
    <Stack>
      <Text size="sm">{entry.date} · {entry.description}</Text>
      <ExpenseTagInput value={tags} options={options} onChange={setTags} label={t("expenseTagsLabel")} placeholder={t("expenseTagsPlaceholder")} />
      <Group justify="flex-end">
        <Button variant="default" onClick={onClose}>{t("cancel")}</Button>
        <Button loading={saving} onClick={() => void save()}>{t("save")}</Button>
      </Group>
    </Stack>
  </Modal>;
}
