import { useRef, useState } from "react";
import type { CreateJournalInput } from "@balance-sheet/shared";
import { useAppData } from "../context/AppDataContext";
import { useLang } from "../i18n";
import { api } from "../api/client";
import { showFeedback } from "../lib/feedback";
import {
  SimpleEntryForm,
  type SimpleFormDraft,
} from "./SimpleEntryForm";

interface Props {
  draft: SimpleFormDraft;
  onSaved: () => void;
  onCancel: () => void;
  onSavingChange?: (saving: boolean) => void;
  submitLabel?: string;
}

/** Shared budget-aware input for journal entries launched from loan management. */
export function LoanManagementEntryForm({
  draft,
  onSaved,
  onCancel,
  onSavingChange,
  submitLabel,
}: Props) {
  const { t } = useLang();
  const { accounts, budgetFilters, displayCurrency, refresh } = useAppData();
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  const entryType = draft.formValues.entryType ?? "loan";

  async function handleSubmit(input: CreateJournalInput) {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    onSavingChange?.(true);
    try {
      await api.journal.create({
        ...input,
        lines: input.lines.map((line) => ({
          ...line,
          currency: line.currency ?? displayCurrency ?? "JPY",
        })),
      });
      await refresh();
      showFeedback({ message: t("entrySaved"), color: "teal" });
      onSaved();
    } finally {
      savingRef.current = false;
      setSaving(false);
      onSavingChange?.(false);
    }
  }

  return (
    <fieldset
      disabled={saving}
      aria-busy={saving || undefined}
      style={{ border: 0, minWidth: 0, margin: 0, padding: 0 }}
    >
      <SimpleEntryForm
        accounts={accounts}
        budgetFilters={budgetFilters}
        initialDraft={draft}
        fixedEntryType={entryType}
        onSubmit={handleSubmit}
        onCancel={onCancel}
        submitLabel={submitLabel}
      />
    </fieldset>
  );
}
