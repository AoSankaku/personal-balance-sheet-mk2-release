import { Alert, Anchor, Button, Checkbox, Group, NumberInput, Paper, SegmentedControl, Skeleton, Stack, Text, Textarea, VisuallyHidden } from "@mantine/core";
import { DateInput } from "@mantine/dates";
import dayjs from "dayjs";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { BudgetAdjustmentPreview } from "@balance-sheet/shared";
import { api, ApiError } from "../api/client";
import { useAppData } from "../context/AppDataContext";
import { useLang } from "../i18n";
import { buildBudgetAdjustmentInput } from "../lib/budgetAdjustmentInput";
import { formatCurrency } from "../lib/numberFormat";
import { showFeedback } from "../lib/feedback";
import { beginBudgetAdjustmentSave, budgetAdjustmentDrafts, finishBudgetAdjustmentSave, setBudgetAdjustmentDraft, type BudgetAdjustmentDraft } from "../utils/inputDrafts";
import classes from "./BudgetAdjustmentEditor.module.css";

export function BudgetAdjustmentEditor({ active, busy, onDone, onReset }: {
  active: boolean;
  busy: boolean;
  onDone: () => void;
  onReset?: () => void;
}) {
  const { t, locale } = useLang();
  const { budgetCategories, displayCurrency, displayCurrencySymbol, enabledCurrencies } = useAppData();
  const currency = displayCurrency || "JPY";
  const draft = budgetAdjustmentDrafts[currency];
  const [date, setDate] = useState(draft?.date ?? new Date());
  const [note, setNote] = useState(draft?.note ?? "");
  const [amounts, setAmounts] = useState<Record<number, number | string>>(draft?.amounts ?? {});
  const [selectedIds, setSelectedIds] = useState<number[]>(draft?.selectedCategoryIds ?? []);
  const [showOnlySelected, setShowOnlySelected] = useState(draft?.showOnlySelected ?? false);
  const [preview, setPreview] = useState<{ key: string; data: BudgetAdjustmentPreview } | null>(null);
  const [previewError, setPreviewError] = useState<{ key: string; message: string } | null>(null);
  const [saveStatus, setSaveStatus] = useState<BudgetAdjustmentDraft["saveStatus"]>(draft?.saveStatus ?? null);
  const [retry, setRetry] = useState(0);
  const [previewLoading, setPreviewLoading] = useState(false);
  const uncertain = saveStatus === "uncertain";
  const submitError = saveStatus === "stale" ? t("budgetBatchStale")
    : saveStatus === "failed" ? t("budgetBatchSaveError")
    : uncertain ? t("budgetBatchSaveUncertain") : null;
  const decimalPlaces = enabledCurrencies.find(item => item.code === currency)?.decimal_places ?? 0;
  const dateString = dayjs(date).format("YYYY-MM-DD");
  const categories = budgetCategories.filter(category => !category.is_archived);
  const selected = new Set(selectedIds);
  const selectionUnavailable = selectedIds.some(id => !categories.some(category => category.id === id));
  const built = useMemo(() => buildBudgetAdjustmentInput({
    date: dateString, currency, note, selectedCategoryIds: selectedIds, amounts, decimalPlaces,
  }), [dateString, currency, note, selectedIds, amounts, decimalPlaces]);
  const requestKey = built == null ? null : JSON.stringify(built.input);
  const inputError = selectionUnavailable ? t("budgetBatchUnavailableCategory")
    : built == null ? t("budgetBatchInvalidAmount")
    : built.input.adjustments.length > 100 ? t("budgetBatchLimit") : null;
  const currentPreview = preview?.key === requestKey && !previewLoading ? preview.data : null;
  const baseline = preview?.data.date === dateString && preview.data.currency === currency ? preview.data : null;
  const currentError = previewError?.key === requestKey ? previewError.message : null;
  const visibleCategories = showOnlySelected ? categories.filter(category => selected.has(category.id)) : categories;
  const canSave = active && !!built?.input.adjustments.length && currentPreview != null && inputError == null && !busy && !uncertain;
  const format = (value: number) => formatCurrency(value, locale, currency, undefined, decimalPlaces);
  const signed = (value: number) => `${value > 0 ? "+" : ""}${format(value)}`;

  useEffect(() => {
    setBudgetAdjustmentDraft(currency, { date, note, amounts, selectedCategoryIds: selectedIds, showOnlySelected, saveStatus });
  }, [currency, date, note, amounts, selectedIds, showOnlySelected, saveStatus]);

  useEffect(() => {
    if (!active || uncertain || requestKey == null || inputError != null || categories.length === 0) {
      setPreviewLoading(false);
      return;
    }
    const controller = new AbortController();
    let disposed = false;
    setPreviewError(null);
    setPreviewLoading(true);
    const timer = window.setTimeout(() => {
      void api.budget.previewAdjustments(JSON.parse(requestKey), { signal: controller.signal })
        .then(data => {
          if (!disposed) {
            setPreview({ key: requestKey, data });
            setPreviewLoading(false);
          }
        })
        .catch(cause => {
          if (!disposed) {
            setPreviewError({ key: requestKey, message: cause instanceof ApiError && cause.status === 409
              ? t("budgetBatchStale") : t("budgetBatchPreviewError") });
            setPreviewLoading(false);
          }
        });
    }, 250);
    return () => { disposed = true; window.clearTimeout(timer); controller.abort(); };
  }, [active, uncertain, requestKey, inputError, categories.length, retry, t]);

  function setSelected(id: number, checked: boolean) {
    setSaveStatus(null);
    setSelectedIds(ids => checked ? [...new Set([...ids, id])] : ids.filter(value => value !== id));
    if (!checked) setAmounts(current => { const next = { ...current }; delete next[id]; return next; });
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSave || !built || !currentPreview || !beginBudgetAdjustmentSave(currency)) return;
    try {
      await api.budget.applyAdjustments({ ...built.input, preview_token: currentPreview.token });
    } catch (cause) {
      // A failed response may follow a successful commit. Never silently
      // obtain a fresh token for an operation whose result is uncertain.
      const outcome = cause instanceof ApiError && cause.status === 409 ? "stale"
        : cause instanceof ApiError && cause.status === 400 ? "failed" : "uncertain";
      finishBudgetAdjustmentSave(currency, outcome);
      return;
    }
    finishBudgetAdjustmentSave(currency, "saved");
    showFeedback({ message: t("budgetAdjusted"), color: "teal" });
    onDone();
  }

  return (
    <form onSubmit={event => void handleSubmit(event)} data-testid="budget-adjustment-editor">
      <fieldset disabled={busy || uncertain} className={classes.fields}>
        <Stack gap="md">
          <DateInput label={t("budgetAdjustDateLabel")} required valueFormat="YYYY-MM-DD" value={date}
            onChange={value => { setDate(value ?? new Date()); setSaveStatus(null); }} />
          <SegmentedControl
            aria-label={t("budgetCategoryLabel")}
            value={showOnlySelected ? "selected" : "all"}
            onChange={value => setShowOnlySelected(value === "selected")}
            data={[{ value: "all", label: t("budgetBatchAll") }, { value: "selected", label: t("budgetBatchSelected") }]}
          />
          {categories.length === 0 ? <Text c="dimmed" size="sm">{t("noBudgetCategories")}</Text> : (
            <div>
              <div className={classes.columns} aria-hidden="true">
                <span>{t("budgetCategoryLabel")}</span><span>{t("budgetBatchBefore")}</span>
                <span>{t("budgetAdjustAmountLabel")}</span><span>{t("budgetBatchAfter")}</span>
              </div>
              {visibleCategories.length === 0 && <Text size="sm" c="dimmed">{t("budgetBatchSelectionEmpty")}</Text>}
              {visibleCategories.map(category => {
                const before = baseline?.categories.find(row => row.budget_category_id === category.id)?.before_available;
                const after = currentPreview?.categories.find(row => row.budget_category_id === category.id)?.after_available;
                return (
                  <div key={category.id} className={classes.row} data-testid={`budget-adjustment-row-${category.id}`}>
                    <Group gap="xs" wrap="nowrap" className={classes.name}>
                      <Checkbox checked={selected.has(category.id)} onChange={event => setSelected(category.id, event.currentTarget.checked)}
                        aria-label={t("budgetBatchSelectLabel").replace("{name}", category.name)} />
                      <Text size="sm">{category.name}</Text>
                    </Group>
                    <Stack gap={2} className={classes.before}>
                      <Text size="xs" c="dimmed" hiddenFrom="sm">{t("budgetBatchBefore")}</Text>
                      {before == null ? <Skeleton height={18} w={80} /> : <Text size="sm" className="currency-token"><VisuallyHidden>{category.name} {t("budgetBatchBefore")}: </VisuallyHidden>{format(before)}</Text>}
                    </Stack>
                    <NumberInput className={classes.amount}
                      aria-label={t("budgetBatchAmountLabel").replace("{name}", category.name)}
                      value={amounts[category.id] ?? 0} disabled={!selected.has(category.id)}
                      onChange={value => { setAmounts(current => ({ ...current, [category.id]: value })); setSaveStatus(null); }}
                      prefix={displayCurrencySymbol} thousandSeparator="," decimalScale={decimalPlaces} allowNegative hideControls />
                    <Stack gap={2} className={classes.after}>
                      <Text size="xs" c="dimmed" hiddenFrom="sm">{t("budgetBatchAfter")}</Text>
                      {after == null ? <Skeleton height={18} w={80} /> : <Text size="sm" fw={600} c={after < 0 ? "red" : undefined} className="currency-token"><VisuallyHidden>{category.name} {t("budgetBatchAfter")}: </VisuallyHidden>{format(after)}</Text>}
                    </Stack>
                  </div>
                );
              })}
            </div>
          )}
          <Paper withBorder p="md" radius="md" aria-busy={active && !uncertain && !currentPreview && !currentError && !inputError}>
            <Stack gap="xs">
              <Group justify="space-between">
                <Text size="sm">{t("budgetBatchTotal")}</Text>
                <Text fw={600} className="currency-token" data-testid="budget-adjustment-total">{built == null ? "—" : signed(built.total)}</Text>
              </Group>
              <Text size="xs" c="dimmed">{t("budgetBatchAsOf").replace("{date}", dateString)}</Text>
              <Group justify="space-between">
                <Text size="sm">{t("budgetBatchAllocatableBefore")}</Text>
                <Text size="sm" className="currency-token">{baseline ? format(baseline.allocatable_before) : "—"}</Text>
              </Group>
              <Group justify="space-between">
                <Text size="sm">{t("budgetBatchAllocatableAfter")}</Text>
                <Text fw={600} c={currentPreview && currentPreview.allocatable_after < 0 ? "red" : undefined}
                  className="currency-token" data-testid="budget-adjustment-allocatable-after">{currentPreview ? format(currentPreview.allocatable_after) : "—"}</Text>
              </Group>
              {active && !uncertain && categories.length > 0 && !currentPreview && !currentError && !inputError && <Text size="xs" c="dimmed" role="status">{t("budgetBatchCalculating")}</Text>}
              <Text size="xs" c="dimmed">{t("budgetBatchHint")}</Text>
            </Stack>
          </Paper>
          {(inputError || currentError || submitError) && <Alert color="red">
            <Stack gap="xs">
              <Text size="sm">{inputError || submitError || currentError}</Text>
              {uncertain && <Anchor component={Link} to="/" size="sm">{t("navOverview")}</Anchor>}
              {currentError && <Button type="button" variant="light" size="xs" w="fit-content" onClick={() => { setPreview(null); setRetry(value => value + 1); }}>{t("reload")}</Button>}
            </Stack>
          </Alert>}
          <Textarea label={t("budgetAdjustNoteLabel")} placeholder={t("budgetAdjustNotePlaceholder")}
            value={note} onChange={event => { setNote(event.currentTarget.value); setSaveStatus(null); }} autosize minRows={2} />
        </Stack>
      </fieldset>
      <Group justify="space-between" mt="md">
        {onReset ? <Button type="button" variant="light" color="gray" disabled={busy} onClick={onReset}>{t("reset")}</Button> : <span />}
        <Button type="submit" disabled={!canSave} loading={busy}>{t("budgetBatchSave")}</Button>
      </Group>
    </form>
  );
}
