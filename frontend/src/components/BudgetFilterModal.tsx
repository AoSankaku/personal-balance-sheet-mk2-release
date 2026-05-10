import {
  ActionIcon,
  Alert,
  Button,
  Group,
  Modal,
  NumberInput,
  Paper,
  SegmentedControl,
  Select,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import {
  IconArrowDown,
  IconArrowUp,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react";
import { useEffect, useState } from "react";
import type {
  BudgetCategory,
  BudgetFilter,
  BudgetFilterStepType,
  CreateBudgetFilterInput,
  CreateBudgetFilterStepInput,
} from "@balance-sheet/shared";
import { api } from "../api/client";
import { useLang } from "../i18n";
import { useAppData } from "../context/AppDataContext";

interface StepAllocationDraft {
  budget_category_id: number | null;
  amount: number;
  ratio: number;
}

interface StepDraft {
  step_type: BudgetFilterStepType;
  allocations: StepAllocationDraft[];
}

interface Props {
  opened: boolean;
  onClose: () => void;
  onSaved: () => void;
  budgetCategories: BudgetCategory[];
  budgetFilters?: BudgetFilter[];
  filter?: BudgetFilter; // if editing/viewing
}

function emptyAlloc(): StepAllocationDraft {
  return { budget_category_id: null, amount: 0, ratio: 0 };
}

function emptyStep(type: BudgetFilterStepType = "fixed"): StepDraft {
  return { step_type: type, allocations: [emptyAlloc()] };
}

function stepsFromFilter(f: BudgetFilter): StepDraft[] {
  if (f.steps.length === 0) return [emptyStep("fixed")];
  return f.steps
    .slice()
    .sort((a, b) => a.step_order - b.step_order)
    .map((s) => ({
      step_type: s.step_type,
      allocations: s.allocations.map((a) => ({
        budget_category_id: a.budget_category_id,
        amount: a.amount ?? 0,
        ratio: a.ratio != null ? Math.round(a.ratio * 100) : 0,
      })),
    }));
}

export function BudgetFilterModal({
  opened,
  onClose,
  onSaved,
  budgetCategories,
  budgetFilters,
  filter,
}: Props) {
  const { t, locale } = useLang();
  const { displayCurrency, enabledCurrencies } = useAppData();
  const selectedCurrency = displayCurrency || "JPY";
  const isReadOnly = false;

  const stepTypeOptions = [
    { value: "fixed", label: t("stepTypeFixed") },
    { value: "capped", label: t("stepTypeCapped") },
    { value: "remainder", label: t("stepTypeRemainder") },
  ];
  const isEdit = Boolean(filter);

  const [name, setName] = useState(filter?.name ?? "");
  const [currency, setCurrency] = useState(
    filter?.currency ?? selectedCurrency,
  );
  const [steps, setSteps] = useState<StepDraft[]>(() => {
    if (filter && filter.steps.length > 0) return stepsFromFilter(filter);
    return [emptyStep("fixed")];
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnModalOpen, setWarnModalOpen] = useState(false);

  const catOptions = budgetCategories.map((c) => ({
    value: String(c.id),
    label: c.name,
  }));

  const filterOptions = (budgetFilters ?? []).map((f) => ({
    value: String(f.id),
    label: f.name,
  }));

  // Sync state when modal opens or filter changes
  useEffect(() => {
    if (!opened) return;
    if (filter) {
      setName(filter.name);
      setCurrency(filter.currency ?? selectedCurrency);
      setSteps(stepsFromFilter(filter));
    } else {
      setName("");
      setCurrency(selectedCurrency || enabledCurrencies[0]?.code || "JPY");
      setSteps([emptyStep("fixed")]);
    }
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened, filter]);

  function handleCopyFrom(filterId: string | null) {
    if (!filterId) return;
    const source = (budgetFilters ?? []).find((f) => String(f.id) === filterId);
    if (!source) return;
    setName(`${source.name}${t("filterCopySuffix")}`);
    setCurrency(source.currency);
    setSteps(stepsFromFilter(source));
  }

  // Validate: only one remainder step, must be last
  function validate(): string | null {
    if (!name.trim()) return t("filterNameRequired");
    if (steps.length === 0) return t("filterStepsRequired");
    const remainderIdx = steps.findIndex((s) => s.step_type === "remainder");
    if (remainderIdx !== -1 && remainderIdx !== steps.length - 1) {
      return t("filterRemainderMustBeLast");
    }
    const remainderCount = steps.filter(
      (s) => s.step_type === "remainder",
    ).length;
    if (remainderCount > 1) return t("filterRemainderOnlyOne");
    for (const step of steps) {
      if (step.step_type === "remainder") {
        const total = step.allocations.reduce((s, a) => s + a.ratio, 0);
        if (Math.abs(total - 100) > 0.5) {
          return `${t("filterRemainderTotalMustBe100")} (${total}%)`;
        }
      }
      for (const alloc of step.allocations) {
        if (alloc.budget_category_id == null) return t("filterSelectCategory");
      }
    }
    return null;
  }

  function handleSave() {
    const err = validate();
    if (err) {
      setError(err);
      return;
    }
    const lastStep = steps[steps.length - 1];
    if (lastStep && lastStep.step_type !== "remainder") {
      setWarnModalOpen(true);
      return;
    }
    void commitSave();
  }

  async function commitSave() {
    setSaving(true);
    setError(null);
    try {
      const input: CreateBudgetFilterInput = {
        name: name.trim(),
        currency,
        steps: steps.map(
          (s, i): CreateBudgetFilterStepInput => ({
            step_order: i,
            step_type: s.step_type,
            allocations: s.allocations.map((a) => ({
              budget_category_id: a.budget_category_id!,
              amount: s.step_type !== "remainder" ? a.amount : undefined,
              ratio: s.step_type === "remainder" ? a.ratio / 100 : undefined,
            })),
          }),
        ),
      };

      if (isEdit && filter) {
        await api.budget.updateFilter(filter.id, {
          name: input.name,
          currency: input.currency,
          steps: input.steps,
        });
      } else {
        await api.budget.createFilter(input);
      }
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  function updateStep(idx: number, patch: Partial<StepDraft>) {
    setSteps((prev) =>
      prev.map((s, i) => {
        if (i !== idx) return s;
        const updated = { ...s, ...patch };
        // Trim to 1 allocation when switching to fixed (only 1 allowed)
        if (patch.step_type === "fixed" && updated.allocations.length > 1) {
          updated.allocations = [updated.allocations[0]!];
        }
        return updated;
      }),
    );
  }

  function moveStep(idx: number, dir: -1 | 1) {
    setSteps((prev) => {
      const next = [...prev];
      const target = idx + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[idx], next[target]] = [next[target]!, next[idx]!];
      return next;
    });
  }

  function removeStep(idx: number) {
    setSteps((prev) => prev.filter((_, i) => i !== idx));
  }

  function addAlloc(stepIdx: number) {
    setSteps((prev) =>
      prev.map((s, i) =>
        i === stepIdx
          ? { ...s, allocations: [...s.allocations, emptyAlloc()] }
          : s,
      ),
    );
  }

  function removeAlloc(stepIdx: number, allocIdx: number) {
    setSteps((prev) =>
      prev.map((s, i) =>
        i === stepIdx
          ? {
              ...s,
              allocations: s.allocations.filter((_, j) => j !== allocIdx),
            }
          : s,
      ),
    );
  }

  function updateAlloc(
    stepIdx: number,
    allocIdx: number,
    patch: Partial<StepAllocationDraft>,
  ) {
    setSteps((prev) =>
      prev.map((s, i) =>
        i === stepIdx
          ? {
              ...s,
              allocations: s.allocations.map((a, j) =>
                j === allocIdx ? { ...a, ...patch } : a,
              ),
            }
          : s,
      ),
    );
  }

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={
        isReadOnly
          ? filter?.name
          : isEdit
            ? t("filterEditTitle")
            : t("filterCreateTitle")
      }
      size="lg"
      centered
    >
      <Stack>
        {isReadOnly && (
          <Alert color="yellow" variant="light">
            {t("filterReadOnlyAlert")}
          </Alert>
        )}

        {/* Copy from existing — only shown when creating a new filter */}
        {!isEdit && !isReadOnly && filterOptions.length > 0 && (
          <Select
            label={t("copyFromExistingLabel")}
            placeholder={t("copyFromExistingPlaceholder")}
            data={filterOptions}
            clearable
            onChange={handleCopyFrom}
          />
        )}

        <TextInput
          label={t("filterNameLabel")}
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          required
          readOnly={isReadOnly}
        />

        {enabledCurrencies.length > 1 && (
          <Select
            label={locale === "ja" ? "通貨" : "Currency"}
            description={
              locale === "ja"
                ? "この分配フィルターが適用される通貨"
                : "Currency this filter applies to"
            }
            data={enabledCurrencies.map((c) => ({
              value: c.code,
              label: c.code,
            }))}
            value={currency}
            onChange={(v) => v && setCurrency(v)}
            allowDeselect={false}
            readOnly={isReadOnly}
          />
        )}

        <Title order={6}>{t("filterStepsTitle")}</Title>

        {steps.map((step, stepIdx) => {
          const cappedTotal =
            step.step_type === "capped"
              ? step.allocations.reduce((s, a) => s + a.amount, 0)
              : 0;

          return (
            <Paper key={stepIdx} withBorder p="sm" radius="sm">
              <Stack gap="xs">
                <Group justify="space-between" wrap="nowrap">
                  <Text size="sm" fw={600}>
                    {t("filterStepLabel")} {stepIdx + 1}
                  </Text>
                  {!isReadOnly && (
                    <Group gap={4} wrap="nowrap">
                      <ActionIcon
                        variant="subtle"
                        size="sm"
                        disabled={stepIdx === 0}
                        onClick={() => moveStep(stepIdx, -1)}
                      >
                        <IconArrowUp size={14} />
                      </ActionIcon>
                      <ActionIcon
                        variant="subtle"
                        size="sm"
                        disabled={stepIdx === steps.length - 1}
                        onClick={() => moveStep(stepIdx, 1)}
                      >
                        <IconArrowDown size={14} />
                      </ActionIcon>
                      <ActionIcon
                        variant="subtle"
                        color="red"
                        size="sm"
                        onClick={() => removeStep(stepIdx)}
                        disabled={steps.length <= 1}
                      >
                        <IconTrash size={14} />
                      </ActionIcon>
                    </Group>
                  )}
                </Group>

                <SegmentedControl
                  data={stepTypeOptions}
                  value={step.step_type}
                  onChange={(v) =>
                    updateStep(stepIdx, {
                      step_type: v as BudgetFilterStepType,
                    })
                  }
                  size="xs"
                  fullWidth
                  disabled={isReadOnly}
                />

                {step.allocations.map((alloc, allocIdx) => {
                  // For capped/remainder steps, exclude categories already selected in other rows
                  const usedIds =
                    step.step_type !== "fixed"
                      ? new Set(
                          step.allocations
                            .filter((_, j) => j !== allocIdx)
                            .map((a) => a.budget_category_id)
                            .filter((id): id is number => id != null),
                        )
                      : null;
                  const availableCatOptions =
                    usedIds != null
                      ? catOptions.filter((o) => !usedIds.has(Number(o.value)))
                      : catOptions;

                  return (
                    <Group
                      key={allocIdx}
                      align="flex-end"
                      gap="xs"
                      wrap="nowrap"
                    >
                      <Select
                        placeholder={t("filterSelectCategoryPlaceholder")}
                        data={availableCatOptions}
                        value={
                          alloc.budget_category_id != null
                            ? String(alloc.budget_category_id)
                            : null
                        }
                        onChange={(v) =>
                          updateAlloc(stepIdx, allocIdx, {
                            budget_category_id: v ? Number(v) : null,
                          })
                        }
                        style={{ flex: 2 }}
                        readOnly={isReadOnly}
                      />
                      {step.step_type === "remainder" ? (
                        <NumberInput
                          placeholder="0"
                          min={0}
                          max={100}
                          suffix="%"
                          value={alloc.ratio}
                          onChange={(v) =>
                            updateAlloc(stepIdx, allocIdx, {
                              ratio: Number(v) || 0,
                            })
                          }
                          style={{ flex: 1 }}
                          readOnly={isReadOnly}
                        />
                      ) : (
                        <>
                          <NumberInput
                            placeholder="0"
                            min={0}
                            thousandSeparator=","
                            prefix="¥"
                            value={alloc.amount}
                            onChange={(v) =>
                              updateAlloc(stepIdx, allocIdx, {
                                amount: Number(v) || 0,
                              })
                            }
                            style={{ flex: 2 }}
                            readOnly={isReadOnly}
                          />
                          {step.step_type === "capped" && cappedTotal > 0 && (
                            <Text
                              size="xs"
                              c="dimmed"
                              style={{ whiteSpace: "nowrap", flexShrink: 0 }}
                            >
                              {Math.round((alloc.amount / cappedTotal) * 100)}%
                            </Text>
                          )}
                        </>
                      )}
                      {!isReadOnly && step.allocations.length > 1 && (
                        <ActionIcon
                          variant="subtle"
                          color="red"
                          size="sm"
                          onClick={() => removeAlloc(stepIdx, allocIdx)}
                        >
                          <IconTrash size={14} />
                        </ActionIcon>
                      )}
                    </Group>
                  );
                })}

                {step.step_type === "capped" && cappedTotal > 0 && (
                  <Text size="xs" c="dimmed">
                    {t("filterCappedTotalLabel")}: ¥
                    {cappedTotal.toLocaleString()}
                  </Text>
                )}
                {step.step_type === "remainder" && (
                  <Text
                    size="xs"
                    c={
                      Math.abs(
                        step.allocations.reduce((s, a) => s + a.ratio, 0) - 100,
                      ) < 0.5
                        ? "teal"
                        : "red"
                    }
                  >
                    {t("filterRemainderTotalLabel")}:{" "}
                    {step.allocations.reduce((s, a) => s + a.ratio, 0)}%
                  </Text>
                )}

                {!isReadOnly && step.step_type !== "fixed" && (
                  <Button
                    variant="subtle"
                    size="xs"
                    leftSection={<IconPlus size={12} />}
                    onClick={() => addAlloc(stepIdx)}
                  >
                    {t("filterAddCategory")}
                  </Button>
                )}
              </Stack>
            </Paper>
          );
        })}

        {!isReadOnly && (
          <Button
            variant="light"
            size="xs"
            leftSection={<IconPlus size={14} />}
            onClick={() => setSteps((prev) => [...prev, emptyStep("fixed")])}
          >
            {t("filterAddStep")}
          </Button>
        )}

        {error && (
          <Alert color="red" variant="light">
            {error}
          </Alert>
        )}

        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {isReadOnly ? t("close") : t("cancel")}
          </Button>
          {!isReadOnly && (
            <Button onClick={() => handleSave()} loading={saving}>
              {t("save")}
            </Button>
          )}
        </Group>
      </Stack>

      {/* No-remainder confirmation modal */}
      <Modal
        opened={warnModalOpen}
        onClose={() => setWarnModalOpen(false)}
        title={t("noRemainderWarningTitle")}
        centered
        size="md"
        zIndex={300}
      >
        <Stack>
          <Text size="sm">{t("noRemainderWarning")}</Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setWarnModalOpen(false)}>
              {t("cancel")}
            </Button>
            <Button
              color="orange"
              loading={saving}
              onClick={() => {
                setWarnModalOpen(false);
                void commitSave();
              }}
            >
              {t("noRemainderWarningConfirm")}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Modal>
  );
}
