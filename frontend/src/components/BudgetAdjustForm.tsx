import {
  Alert,
  Button,
  Checkbox,
  Group,
  NumberInput,
  Paper,
  Select,
  Stack,
  Text,
  Textarea,
} from "@mantine/core";
import { DateInput } from "@mantine/dates";
import { Link } from "react-router-dom";
import dayjs from "dayjs";
import { useEffect, useState } from "react";
import type { DepreciationResetInputDecision } from "@balance-sheet/shared";
import { api, ApiError } from "../api/client";
import { useLang } from "../i18n";
import { useAppData } from "../context/AppDataContext";
import { showFeedback } from "../lib/feedback";
import { formatCurrency } from "../lib/numberFormat";
import { normalizeBudgetAdjustmentNote } from "../lib/budgetAdjustmentNote";
import { budgetDraft, setBudgetDraft } from "../utils/inputDrafts";

type ResetPlan = Awaited<ReturnType<typeof api.budget.depreciationResetPlans>>["plans"][number];
type ResetDecision = Partial<DepreciationResetInputDecision> & Pick<DepreciationResetInputDecision, "schedule_id">;

export function BudgetAdjustForm({
  onDone,
  onReset,
}: {
  onDone: (result?: { categoryArchived?: boolean }) => void;
  onReset?: () => void;
}) {
  const { t, locale } = useLang();
  const {
    budgetCategories,
    allocatableToday,
    allocatableTotal,
    displayCurrency,
    displayCurrencySymbol: currencySymbol,
  } = useAppData();
  const [categoryId, setCategoryId] = useState<string | null>(
    budgetDraft?.categoryId ?? null,
  );
  const [amount, setAmount] = useState<number | string>(
    budgetDraft?.amount ?? 0,
  );
  const [date, setDate] = useState<Date>(budgetDraft?.date ?? new Date());
  const [note, setNote] = useState(budgetDraft?.note ?? "");
  const [resettingBudget, setResettingBudget] = useState(false);
  const [isBudgetReset, setIsBudgetReset] = useState(false);
  const [archiveAfterReset, setArchiveAfterReset] = useState(false);
  const selectedCurrency = displayCurrency || "JPY";
  const [resetPlans, setResetPlans] = useState<ResetPlan[]>([]);
  const [resetDecisions, setResetDecisions] = useState<Record<number, ResetDecision>>({});
  const [plansKey, setPlansKey] = useState<string | null>(null);
  const [resetSubmitError, setResetSubmitError] = useState<string | null>(null);
  const [resetNeedsRepair, setResetNeedsRepair] = useState(false);
  const currentPlansKey = categoryId
    ? `${categoryId}:${dayjs(date).format("YYYY-MM-DD")}:${selectedCurrency}`
    : null;
  const plansAreCurrent = !!currentPlansKey && currentPlansKey === plansKey;
  const archiveCanProceed = resetPlans.every((plan) => {
    const decision = resetDecisions[plan.schedule_id];
    return decision?.action === "end" ||
      (plan.method === "special" && plan.special_category_id === Number(categoryId) && decision?.action === "settle");
  });
  const canSubmit =
    !resettingBudget &&
    !!categoryId &&
    (Number(amount) !== 0 || (isBudgetReset && archiveAfterReset)) &&
    (!isBudgetReset || (plansAreCurrent && resetPlans.every((plan) => {
      const decision = resetDecisions[plan.schedule_id];
      if (!decision) return false;
      if (plan.method === "special" && decision.action === "settle" &&
          decision.settlement_source_category_id === undefined) return false;
      return true;
    }) && (!archiveAfterReset || archiveCanProceed)));

  useEffect(() => {
    setBudgetDraft({ categoryId, amount, date, note });
  }, [categoryId, amount, date, note]);

  const catOptions = budgetCategories.filter((c) => !c.is_archived).map((c) => ({
    value: String(c.id),
    label: c.name,
  }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const delta = Number(amount);
    if (!canSubmit) return;
    const yearMonth = dayjs(date).format("YYYY-MM");
    setResetSubmitError(null);
    setResetNeedsRepair(false);
    try {
      await api.budget.patchAdhocAllocation({
      budget_category_id: Number(categoryId),
      year_month: yearMonth,
      currency: selectedCurrency,
      adhoc_delta: delta,
      date: dayjs(date).format("YYYY-MM-DD"),
      note: normalizeBudgetAdjustmentNote(note),
      adjustment_type: isBudgetReset ? "reset" : "allocation",
      archive_category: isBudgetReset && archiveAfterReset,
      depreciation_decisions: isBudgetReset
        ? resetPlans
            .map((plan) => resetDecisions[plan.schedule_id])
            .filter((decision): decision is ResetDecision & { action: NonNullable<ResetDecision["action"]> } => Boolean(decision?.action))
        : undefined,
      });
    } catch (cause) {
      const code = cause instanceof ApiError ? cause.body.error : null;
      setResetNeedsRepair(code === "depreciation_routing_required");
      setResetSubmitError(
        code === "depreciation_routing_required"
          ? t("depreciationBudgetArchiveResetUnavailable")
          : code === "depreciation_reset_decision_required"
            ? t("depreciationBudgetResetDecisionRequired")
            : cause instanceof Error
              ? cause.message
              : t("depreciationBudgetResetPlansError"),
      );
      return;
    }
    showFeedback({ message: t("budgetAdjusted"), color: "teal" });
    setBudgetDraft(null);
    setCategoryId(null);
    setAmount(0);
    setNote("");
    setIsBudgetReset(false);
    setArchiveAfterReset(false);
    setResetPlans([]);
    setResetDecisions({});
    setPlansKey(null);
    setDate(new Date());
    onDone({ categoryArchived: isBudgetReset && archiveAfterReset });
  }

  async function handleBrokenBudgetReset() {
    if (!categoryId) return;
    setResettingBudget(true);
    setPlansKey(null);
    setResetPlans([]);
    setResetSubmitError(null);
    setResetNeedsRepair(false);
    try {
      const yearMonth = dayjs(date).format("YYYY-MM");
      const asOf = dayjs(date).format("YYYY-MM-DD");
      const [summary, plansResult] = await Promise.all([
        api.budget.summary(yearMonth, asOf, selectedCurrency),
        api.budget.depreciationResetPlans({
          category_id: Number(categoryId),
          date: asOf,
          currency: selectedCurrency,
        }),
      ]);
      const categorySummary = summary.categories.find(
        (category) => category.category.id === Number(categoryId),
      );
      setAmount(categorySummary ? -categorySummary.available : 0);
      setIsBudgetReset(true);
      setResetPlans(plansResult.plans);
      setResetDecisions(Object.fromEntries(plansResult.plans.map((plan) => [
        plan.schedule_id,
        plan.method === "special"
          ? { schedule_id: plan.schedule_id, action: "carry" as const }
          : { schedule_id: plan.schedule_id },
      ])));
      setPlansKey(`${categoryId}:${asOf}:${selectedCurrency}`);
    } catch (cause) {
      showFeedback({
        message: cause instanceof Error ? cause.message : t("depreciationBudgetResetPlansError"),
        color: "red",
      });
    } finally {
      setResettingBudget(false);
    }
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)}>
      <Stack>
        <Paper withBorder px="md" py="xs" radius="md">
          <Group gap={6} align="center">
            <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
              {t("assignableMoneyLabel")}
            </Text>
            <Text size="sm" fw={700} c={allocatableToday >= 0 ? "teal" : "red"}>
              {formatCurrency(allocatableToday, locale, selectedCurrency)}
            </Text>
            <Text size="xs" c="dimmed">
              {t("assignableMoneyTodayLabel")}
            </Text>
            <Text size="sm" c={allocatableTotal >= 0 ? "dimmed" : "red"}>
              {formatCurrency(allocatableTotal, locale, selectedCurrency)}
            </Text>
            <Text size="xs" c="dimmed">
              {t("assignableMoneyTotalLabel")}
            </Text>
          </Group>
        </Paper>
        <DateInput
          label={t("budgetAdjustDateLabel")}
          required
          valueFormat="YYYY-MM-DD"
          value={date}
          onChange={(v) => setDate(v ?? new Date())}
        />
        <Select
          label={t("budgetCategoryLabel")}
          data={catOptions}
          value={categoryId}
          onChange={setCategoryId}
          searchable
          required
        />
        <NumberInput
          label={t("budgetAdjustAmountLabel")}
          value={amount}
          onChange={(value) => {
            setAmount(value);
            setIsBudgetReset(false);
            setArchiveAfterReset(false);
          }}
          prefix={currencySymbol}
          thousandSeparator=","
          allowNegative
        />
        <Textarea
          label={t("budgetAdjustNoteLabel")}
          placeholder={t("budgetAdjustNotePlaceholder")}
          value={note}
          onChange={(event) => setNote(event.currentTarget.value)}
          autosize
          minRows={2}
        />
        <Group justify="flex-start">
          <Button
            type="button"
            variant="light"
            color="red"
            disabled={!categoryId}
            loading={resettingBudget}
            onClick={() => void handleBrokenBudgetReset()}
          >
            {t("budgetResetToZeroButton")}
          </Button>
        </Group>
        {isBudgetReset && (
          <Stack gap="xs">
            {!plansAreCurrent ? (
              <Alert color="yellow">{t("depreciationBudgetResetPlanStale")}</Alert>
            ) : resetPlans.length > 0 ? (
              <Stack gap="xs">
                <Text size="sm" fw={600}>{t("depreciationBudgetResetPlansTitle")}</Text>
                {resetPlans.some((plan) => plan.method === "special" && plan.special_category_id === Number(categoryId)) && (
                  <Text size="xs" c="dimmed">{t("depreciationBudgetResetPlansHint")}</Text>
                )}
                <Button component={Link} to="/fs/report" size="xs" variant="subtle" w="fit-content">
                  {t("depreciationBudgetOpenSchedules")}
                </Button>
                {resetPlans.map((plan) => {
                  const decision = resetDecisions[plan.schedule_id];
                  const actionOptions = plan.method === "special"
                    ? [
                        { value: "carry", label: t("depreciationBudgetDecisionCarry") },
                        { value: "settle", label: t("depreciationBudgetDecisionSettle") },
                      ]
                    : [
                        { value: "continue", label: t("depreciationBudgetDecisionContinue") },
                        { value: "end", label: t("depreciationBudgetDecisionEnd") },
                      ];
                  return (
                    <Paper key={plan.schedule_id} withBorder p="sm">
                      <Stack gap="xs">
                        <Group justify="space-between">
                          <Text size="sm" fw={600}>{plan.description}</Text>
                          <Text size="sm">{formatCurrency(plan.remaining_amount, locale, selectedCurrency)}</Text>
                        </Group>
                        <Select
                          label={t("depreciationBudgetBoundaryDecision")}
                          data={actionOptions}
                          value={decision?.action ?? null}
                          onChange={(action) => {
                            if (!action) return;
                            const next: ResetDecision = { schedule_id: plan.schedule_id, action: action as ResetDecision["action"] };
                            if (action === "settle") next.settlement_source_category_id = null;
                            setResetDecisions((current) => ({ ...current, [plan.schedule_id]: next }));
                          }}
                          required
                        />
                        {decision?.action === "settle" && (
                          <Select
                            label={t("depreciationBudgetResetSettlementSource")}
                            data={[
                              { value: "U", label: t("depreciationBudgetUnallocatedSource") },
                              ...catOptions.filter((category) => category.value !== String(plan.destination_category_id)),
                            ]}
                            value={decision.settlement_source_category_id == null ? "U" : String(decision.settlement_source_category_id)}
                            onChange={(value) => setResetDecisions((current) => ({
                              ...current,
                              [plan.schedule_id]: { ...decision, settlement_source_category_id: value && value !== "U" ? Number(value) : null },
                            }))}
                            required searchable
                          />
                        )}
                        {plan.method === "special" &&
                          plan.special_category_id === Number(categoryId) &&
                          decision?.action === "carry" && (
                          <Text size="xs" c="dimmed">{t("depreciationBudgetResetCarryHint")}</Text>
                        )}
                      </Stack>
                    </Paper>
                  );
                })}
              </Stack>
            ) : null}
            <Checkbox
              label={t("archiveBudgetCategoryAfterReset")}
              checked={archiveAfterReset}
              onChange={(event) => setArchiveAfterReset(event.currentTarget.checked)}
            />
            {resetPlans.length > 0 && !archiveCanProceed && (
              <Alert color="yellow">
                <Stack gap="xs">
                  <Text size="sm">{t("depreciationBudgetArchiveResetUnavailable")}</Text>
                  <Button component={Link} to="/fs/report" size="xs" variant="light" w="fit-content">
                    {t("depreciationBudgetOpenSchedules")}
                  </Button>
                </Stack>
              </Alert>
            )}
          </Stack>
        )}
        {resetSubmitError && (
          <Alert color="red">
            <Stack gap="xs">
              <Text size="sm">{resetSubmitError}</Text>
              {resetNeedsRepair && (
                <Button component={Link} to="/fs/report" size="xs" variant="light" w="fit-content">
                  {t("depreciationBudgetOpenSchedules")}
                </Button>
              )}
            </Stack>
          </Alert>
        )}
        <Group justify="space-between">
          <Group>
            {onReset && (
              <Button variant="light" color="gray" onClick={onReset}>
                {t("reset")}
              </Button>
            )}
          </Group>
          <Button type="submit" disabled={!canSubmit}>
            {t("add")}
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
