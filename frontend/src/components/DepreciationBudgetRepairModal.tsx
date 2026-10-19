import {
  ActionIcon,
  Alert,
  Button,
  Divider,
  Group,
  Modal,
  NumberInput,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Title,
} from "@mantine/core";
import { DateInput } from "@mantine/dates";
import { IconPlus, IconTrash } from "@tabler/icons-react";
import dayjs from "dayjs";
import { useEffect, useMemo, useState } from "react";
import type {
  DepreciationBudgetBoundary,
  DepreciationBudgetProgress,
  DepreciationBudgetResetDecision,
  DepreciationBudgetSnapshot,
  DepreciationBudgetSettings,
  DepreciationSchedule,
} from "@balance-sheet/shared";
import { api, ApiError } from "../api/client";
import { useAppData } from "../context/AppDataContext";
import { useLang } from "../i18n";
import { formatCurrency } from "../lib/numberFormat";
import { showFeedback } from "../lib/feedback";
import { DepreciationBudgetFields } from "./DepreciationBudgetFields";

interface Props {
  opened: boolean;
  schedule: DepreciationSchedule & { budget: DepreciationBudgetProgress };
  onClose: () => void;
  onApplied?: () => void | Promise<void>;
}

function makeKey() {
  return globalThis.crypto?.randomUUID?.() ??
    `settlement-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function parseDate(value: string | null | undefined) {
  return value && dayjs(value).isValid() ? dayjs(value).toDate() : null;
}

function toDateString(value: Date | null) {
  return value && dayjs(value).isValid() ? dayjs(value).format("YYYY-MM-DD") : "";
}

function sumCategoryBalances(snapshot: {
  categories: Array<{ balance: number }>;
}) {
  return snapshot.categories.reduce((total, category) => total + category.balance, 0);
}

const PREVIEW_WARNING_TRANSLATIONS: Record<string, string> = {
  invalid_budget_method: "depreciationBudgetMethodRequired",
  purchase_category_required: "depreciationBudgetCategoryRequired",
  monthly_source_category_required: "depreciationBudgetCategoryRequired",
  source_and_destination_must_differ: "depreciationBudgetCategoriesMustDiffer",
  unallocated_confirmation_required: "depreciationBudgetConfirmationRequired",
  unallocated_confirm_required: "depreciationBudgetConfirmationRequired",
  invalid_routing_change: "depreciationBudgetPreviewFailed",
  invalid_settlement: "depreciationBudgetPreviewFailed",
  budget_category_not_found: "depreciationBudgetCategoryRequired",
  routing_change_before_purchase: "depreciationBudgetRouteDate",
  budget_category_archived: "depreciationBudgetArchiveBlockedMessage",
  reset_decision_required: "depreciationBudgetResetDecisionRequired",
  ambiguous_legacy_allocations: "depreciationBudgetAmbiguousLegacyWarning",
};

const TIMELINE_LABEL_TRANSLATIONS: Record<string, string> = {
  purchase: "depreciationBudgetTimelinePurchase",
  reset: "depreciationBudgetTimelineReset",
  current: "depreciationBudgetTimelineCurrent",
};

export function DepreciationBudgetRepairModal({
  opened,
  schedule,
  onClose,
  onApplied,
}: Props) {
  const { t, locale } = useLang();
  const { budgetCategories, displayCurrency } = useAppData();
  const [settings, setSettings] = useState<DepreciationBudgetSettings | null>(
    null,
  );
  const [preview, setPreview] = useState<Awaited<
    ReturnType<typeof api.depreciation.previewBudget>
  > | null>(null);
  const [boundaryEditor, setBoundaryEditor] = useState<
    DepreciationBudgetBoundary[]
  >([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [applyLoading, setApplyLoading] = useState(false);
  const [applyConfirmOpened, setApplyConfirmOpened] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewStale, setPreviewStale] = useState(false);
  const currency = schedule.budget.currency || displayCurrency || "JPY";
  const categoryOptions = useMemo(
    () =>
      budgetCategories
        .filter((category) => !category.is_archived)
        .map((category) => ({
          value: String(category.id),
          label: category.name,
        })),
    [budgetCategories],
  );
  const settlementSourceOptions = [
    { value: "U", label: t("depreciationBudgetUnallocatedSource") },
    ...categoryOptions,
  ];

  useEffect(() => {
    if (!opened) return;
    setSettings(schedule.budget.settings);
    setPreview(null);
    setBoundaryEditor([]);
    setError(null);
    setPreviewStale(false);
    setApplyConfirmOpened(false);
  }, [opened, schedule.id, schedule.budget.revision]);

  function changeSettings(next: DepreciationBudgetSettings | null) {
    setSettings(next);
    if (preview) setBoundaryEditor(preview.boundaries);
    setPreview(null);
    setPreviewStale(true);
    setApplyConfirmOpened(false);
    setError(null);
  }

  function updateSettings(patch: Partial<DepreciationBudgetSettings>) {
    if (!settings) return;
    changeSettings({ ...settings, ...patch });
  }

  function updateDecision(
    boundary: DepreciationBudgetBoundary,
    patch: Partial<DepreciationBudgetResetDecision>,
  ) {
    if (!settings) return;
    const existing = settings.reset_decisions ?? [];
    const current = existing.find(
      (decision) => decision.reset_log_id === boundary.reset_log_id,
    );
    const actionKind =
      boundary.action_kind ??
      (boundary.required_action === "order"
        ? settings.method === "special"
          ? "carry_or_settle"
          : "continue_or_end"
        : boundary.required_action);
    const allowedActions =
      actionKind === "continue_or_end"
        ? ["continue", "end"]
        : actionKind === "carry_or_settle"
          ? ["carry", "settle"]
          : null;
    const defaultAction =
      actionKind === "carry_or_settle" || settings.method === "special"
        ? "carry"
        : "continue";
    const action =
      current?.action && allowedActions?.includes(current.action)
        ? current.action
        : defaultAction;
    const nextDecision: DepreciationBudgetResetDecision = {
      reset_log_id: boundary.reset_log_id,
      action,
      ...current,
      ...patch,
    };
    const resetDecisions = [
      ...existing.filter(
        (decision) => decision.reset_log_id !== boundary.reset_log_id,
      ),
      nextDecision,
    ];
    updateSettings({ reset_decisions: resetDecisions });
  }

  function decisionFor(boundary: DepreciationBudgetBoundary) {
    return settings?.reset_decisions?.find(
      (decision) => decision.reset_log_id === boundary.reset_log_id,
    );
  }

  function validateSettings(current: DepreciationBudgetSettings) {
    if (current.method === "assigned") {
      if (current.purchase_category_id == null) {
        return t("depreciationBudgetCategoryRequired");
      }
      if (current.monthly_source_category_id == null) {
        return t("depreciationBudgetCategoryRequired");
      }
      if (
        current.purchase_category_id === current.monthly_source_category_id
      ) {
        return t("depreciationBudgetCategoriesMustDiffer");
      }
    }
    if (
      (current.method === "assigned" || current.method === "special") &&
      current.monthly_source_category_id == null
    ) {
      return t("depreciationBudgetCategoryRequired");
    }
    if (current.method === "unallocated" && !current.confirm_unallocated) {
      return t("depreciationBudgetConfirmationRequired");
    }
    for (const settlement of current.settlements ?? []) {
      if (!settlement.date || settlement.amount <= 0) {
        return t("depreciationBudgetCategoryRequired");
      }
    }
    for (const route of current.routing_changes ?? []) {
      if (
        !route.date ||
        route.monthly_source_category_id == null ||
        route.destination_category_id == null
      ) {
        return t("depreciationBudgetCategoryRequired");
      }
    }
    return null;
  }

  async function handlePreview() {
    if (!settings) {
      setError(t("depreciationBudgetMethodRequired"));
      return;
    }
    const validationMessage = validateSettings(settings);
    if (validationMessage) {
      setError(validationMessage);
      return;
    }

    setPreviewLoading(true);
    setPreview(null);
    setError(null);
    setApplyConfirmOpened(false);
    try {
      const first = await api.depreciation.previewBudget(schedule.id, settings);
      setBoundaryEditor(first.boundaries);
      const existingResetIds = new Set(
        (settings.reset_decisions ?? []).map((decision) => decision.reset_log_id),
      );
      const defaultCarryDecisions =
        settings.method === "special"
          ? first.boundaries
              .filter(
                (boundary) =>
                  (boundary.action_kind ?? boundary.required_action) ===
                    "carry_or_settle" &&
                  !existingResetIds.has(boundary.reset_log_id),
              )
              .map((boundary) => ({
                reset_log_id: boundary.reset_log_id,
                action: "carry" as const,
              }))
          : [];
      if (defaultCarryDecisions.length > 0) {
        const withDefaults = {
          ...settings,
          reset_decisions: [
            ...(settings.reset_decisions ?? []),
            ...defaultCarryDecisions,
          ],
        };
        setSettings(withDefaults);
        const second = await api.depreciation.previewBudget(
          schedule.id,
          withDefaults,
        );
        setBoundaryEditor(second.boundaries);
        setPreview(second);
        setPreviewStale(false);
      } else {
        setPreview(first);
        setPreviewStale(false);
      }
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : t("depreciationBudgetPreviewFailed"),
      );
    } finally {
      setPreviewLoading(false);
    }
  }

  async function handleApply() {
    if (!preview || !settings || !preview.can_apply || previewStale) return;
    setApplyLoading(true);
    try {
      await api.depreciation.applyBudget(schedule.id, {
        token: preview.token,
        settings,
        confirmed: true,
      });
      showFeedback({ message: t("depreciationBudgetApplied"), color: "teal" });
      setApplyConfirmOpened(false);
      await onApplied?.();
      onClose();
    } catch (cause) {
      const stale = cause instanceof ApiError && cause.status === 409;
      setError(
        stale
          ? t("depreciationBudgetPreviewStale")
          : cause instanceof Error
            ? cause.message
            : t("depreciationBudgetPreviewFailed"),
      );
      setPreview(null);
      setPreviewStale(true);
      setApplyConfirmOpened(false);
    } finally {
      setApplyLoading(false);
    }
  }

  const visibleBoundaries = preview?.boundaries ?? boundaryEditor;
  const previewCurrency = preview?.progress.currency || currency;

  function renderSnapshot(snapshot: DepreciationBudgetSnapshot) {
    const relatedCategoryIds = new Set<number>([
      schedule.budget.purchase_category_id ?? -schedule.id,
      schedule.budget.monthly_source_category_id ?? -schedule.id,
      schedule.budget.destination_category_id ?? -schedule.id,
      settings?.purchase_category_id ?? -schedule.id,
      settings?.monthly_source_category_id ?? -schedule.id,
      ...(settings?.routing_changes ?? []).flatMap((route) => [
        route.monthly_source_category_id,
        route.destination_category_id,
      ]),
      ...(settings?.settlements ?? [])
        .map((settlement) => settlement.source_category_id)
        .filter((id): id is number => id != null),
    ]);
    const relatedCategories = snapshot.categories.filter((category) =>
      relatedCategoryIds.has(category.id),
    );
    const values = [
      [t("depreciationBudgetTotalLabel"), snapshot.T],
      [t("depreciationBudgetUnallocatedLabel"), snapshot.U],
      [t("depreciationBudgetCategoriesLabel"), sumCategoryBalances(snapshot)],
      [t("depreciationBudgetAllocatableLabel"), snapshot.allocatable],
    ] as const;
    return (
      <Stack gap={2}>
        {values.map(([label, amount]) => (
          <Group key={label} justify="space-between" gap="xs" wrap="nowrap">
            <Text size="xs" c="dimmed">{label}</Text>
            <Text size="xs" fw={600} ta="right">
              {formatCurrency(amount, locale, previewCurrency)}
            </Text>
          </Group>
        ))}
        <Divider my={2} />
        <Group justify="space-between" gap="xs" wrap="nowrap">
          <Text size="xs" c="dimmed">{t("depreciationBudgetReimbursedLabel")}</Text>
          <Text size="xs" fw={600} ta="right">
            {formatCurrency(snapshot.reimbursed_amount, locale, previewCurrency)}
          </Text>
        </Group>
        <Group justify="space-between" gap="xs" wrap="nowrap">
          <Text size="xs" c="dimmed">{t("depreciationBudgetRemainingLabel")}</Text>
          <Text size="xs" fw={600} ta="right">
            {formatCurrency(snapshot.remaining_amount, locale, previewCurrency)}
          </Text>
        </Group>
        {relatedCategories.length > 0 && (
          <Stack gap={2} mt={2}>
            <Text size="xs" c="dimmed">{t("depreciationBudgetRelatedBalances")}</Text>
            {relatedCategories.map((category) => (
              <Group key={category.id} justify="space-between" gap="xs" wrap="nowrap">
                <Text size="xs" c="dimmed">{category.name}</Text>
                <Text size="xs" fw={600} ta="right">
                  {formatCurrency(category.balance, locale, previewCurrency)}
                </Text>
              </Group>
            ))}
          </Stack>
        )}
      </Stack>
    );
  }

  return (
    <>
      <Modal
        opened={opened}
        onClose={onClose}
        title={t("depreciationBudgetRepairTitle")}
        centered
        size="xl"
      >
        <Stack gap="md">
          <Text size="sm" c="dimmed">
            {t("depreciationBudgetRepairHint")}
          </Text>

          <DepreciationBudgetFields
            value={settings}
            onChange={changeSettings}
            purchaseAmount={schedule.budget.target_amount}
            purchaseBalanceAfter={preview?.timeline.find(point=>point.label==='purchase')?.after.categories
              .find(category=>category.id===settings?.purchase_category_id)?.balance ?? null}
            currency={previewCurrency}
          />

          {settings && (
            <>
              <Divider />
              <Stack gap="xs">
                <Group justify="space-between">
                  <Title order={5}>{t("depreciationBudgetRouteTitle")}</Title>
                  <Button
                    size="xs"
                    variant="light"
                    leftSection={<IconPlus size={14} />}
                    onClick={() =>
                      updateSettings({
                        routing_changes: [
                          ...(settings.routing_changes ?? []),
                          {
                            date: dayjs().format("YYYY-MM-DD"),
                            monthly_source_category_id:
                              settings.monthly_source_category_id ?? 0,
                            destination_category_id:
                              settings.purchase_category_id ?? 0,
                          },
                        ],
                      })
                    }
                  >
                    {t("depreciationBudgetRouteAdd")}
                  </Button>
                </Group>
                {(settings.routing_changes ?? []).map((route, index) => (
                  <Paper key={`${route.date}-${index}`} withBorder p="xs">
                    <SimpleGrid cols={{ base: 1, sm: 3 }}>
                      <DateInput
                        label={t("depreciationBudgetRouteDate")}
                        value={parseDate(route.date)}
                        valueFormat="YYYY-MM-DD"
                        onChange={(date) => {
                          const routes = [...(settings.routing_changes ?? [])];
                          routes[index] = {
                            ...route,
                            date: toDateString(date),
                          };
                          updateSettings({ routing_changes: routes });
                        }}
                      />
                      <Select
                        label={t("depreciationBudgetMonthlySourceLabel")}
                        data={categoryOptions}
                        value={
                          route.monthly_source_category_id
                            ? String(route.monthly_source_category_id)
                            : null
                        }
                        onChange={(selected) => {
                          const routes = [...(settings.routing_changes ?? [])];
                          routes[index] = {
                            ...route,
                            monthly_source_category_id: selected
                              ? Number(selected)
                              : 0,
                          };
                          updateSettings({ routing_changes: routes });
                        }}
                        searchable
                        clearable
                      />
                      <Group align="end" gap="xs" wrap="nowrap">
                        <Select
                          label={t("depreciationBudgetDestinationCategory")}
                          data={categoryOptions}
                          value={
                            route.destination_category_id
                              ? String(route.destination_category_id)
                              : null
                          }
                          onChange={(selected) => {
                            const routes = [...(settings.routing_changes ?? [])];
                            routes[index] = {
                              ...route,
                              destination_category_id: selected
                                ? Number(selected)
                                : 0,
                            };
                            updateSettings({ routing_changes: routes });
                          }}
                          searchable
                          clearable
                          style={{ flex: 1 }}
                        />
                        <ActionIcon
                          color="red"
                          variant="subtle"
                          aria-label={t("depreciationBudgetRemoveChange")}
                          onClick={() =>
                            updateSettings({
                              routing_changes: settings.routing_changes?.filter(
                                (_, routeIndex) => routeIndex !== index,
                              ),
                            })
                          }
                        >
                          <IconTrash size={16} />
                        </ActionIcon>
                      </Group>
                    </SimpleGrid>
                  </Paper>
                ))}
              </Stack>

              <Stack gap="xs">
                <Group justify="space-between">
                  <Title order={5}>{t("depreciationBudgetSettlementTitle")}</Title>
                  <Button
                    size="xs"
                    variant="light"
                    leftSection={<IconPlus size={14} />}
                    onClick={() =>
                      updateSettings({
                        settlements: [
                          ...(settings.settlements ?? []),
                          {
                            key: makeKey(),
                            date: dayjs().format("YYYY-MM-DD"),
                            amount: 0,
                            source_category_id: null,
                          },
                        ],
                      })
                    }
                  >
                    {t("depreciationBudgetSettlementAdd")}
                  </Button>
                </Group>
                {(settings.settlements ?? []).map((settlement, index) => (
                  <Paper key={settlement.key} withBorder p="xs">
                    <SimpleGrid cols={{ base: 1, sm: 3 }}>
                      <DateInput
                        label={t("depreciationBudgetSettlementDate")}
                        value={parseDate(settlement.date)}
                        valueFormat="YYYY-MM-DD"
                        onChange={(date) => {
                          const settlements = [...(settings.settlements ?? [])];
                          settlements[index] = {
                            ...settlement,
                            date: toDateString(date),
                          };
                          updateSettings({ settlements });
                        }}
                      />
                      <NumberInput
                        label={t("depreciationBudgetSettlementAmount")}
                        min={0}
                        value={settlement.amount}
                        prefix={currency === "JPY" ? "¥" : undefined}
                        thousandSeparator=","
                        onChange={(amount) => {
                          const settlements = [...(settings.settlements ?? [])];
                          settlements[index] = {
                            ...settlement,
                            amount: Number(amount) || 0,
                          };
                          updateSettings({ settlements });
                        }}
                      />
                      <Group align="end" gap="xs" wrap="nowrap">
                        <Select
                          label={t("depreciationBudgetSettlementSource")}
                          data={settlementSourceOptions}
                          value={
                            settlement.source_category_id == null
                              ? "U"
                              : String(settlement.source_category_id)
                          }
                          onChange={(source) => {
                            const settlements = [...(settings.settlements ?? [])];
                            settlements[index] = {
                              ...settlement,
                              source_category_id:
                                source && source !== "U"
                                  ? Number(source)
                                  : null,
                            };
                            updateSettings({ settlements });
                          }}
                          searchable
                          style={{ flex: 1 }}
                        />
                        <ActionIcon
                          color="red"
                          variant="subtle"
                          aria-label={t("depreciationBudgetRemoveChange")}
                          onClick={() =>
                            updateSettings({
                              settlements: settings.settlements?.filter(
                                (_, settlementIndex) => settlementIndex !== index,
                              ),
                            })
                          }
                        >
                          <IconTrash size={16} />
                        </ActionIcon>
                      </Group>
                    </SimpleGrid>
                  </Paper>
                ))}
              </Stack>

              <DateInput
                label={t("depreciationBudgetEndDate")}
                value={parseDate(settings.end_date)}
                valueFormat="YYYY-MM-DD"
                clearable
                onChange={(date) =>
                  updateSettings({ end_date: date ? toDateString(date) : null })
                }
              />
            </>
          )}

          {visibleBoundaries.length > 0 && settings && (
            <Stack gap="xs">
              <Title order={5}>{t("depreciationBudgetBoundaryTitle")}</Title>
              {visibleBoundaries.map((boundary) => {
                const decision = decisionFor(boundary);
                const actionKind =
                  boundary.action_kind ??
                  (boundary.required_action === "order"
                    ? settings.method === "special"
                      ? "carry_or_settle"
                      : "continue_or_end"
                    : boundary.required_action);
                const actionOptions =
                  actionKind === "continue_or_end"
                    ? [
                        {
                          value: "continue",
                          label: t("depreciationBudgetDecisionContinue"),
                        },
                        {
                          value: "end",
                          label: t("depreciationBudgetDecisionEnd"),
                        },
                      ]
                    : actionKind === "carry_or_settle"
                      ? [
                          {
                            value: "carry",
                            label: t("depreciationBudgetDecisionCarry"),
                          },
                          {
                            value: "settle",
                            label: t("depreciationBudgetDecisionSettle"),
                          },
                        ]
                      : [];
                return (
                  <Paper key={boundary.reset_log_id} withBorder p="sm">
                    <Stack gap="xs">
                      <Group justify="space-between">
                        <Text size="sm" fw={600}>
                          {boundary.date} · {boundary.category_name}
                        </Text>
                        <Text size="xs" c="dimmed">
                          {boundary.scope_confirmation_required
                            ? t("depreciationBudgetScopeUnconfirmed")
                            : boundary.scope === "all"
                              ? t("reset")
                              : t("budgetCategoryLabel")}
                        </Text>
                      </Group>
                      <SimpleGrid cols={{ base: 1, sm: 2 }}>
                        <Text size="xs">
                          {t("depreciationBudgetBoundaryOldReset")}: {formatCurrency(boundary.old_reset_amount, locale, currency)}
                        </Text>
                        <Text size="xs">
                          {t("depreciationBudgetBoundaryNewReset")}: {formatCurrency(boundary.new_reset_amount, locale, currency)}
                        </Text>
                      </SimpleGrid>
                      {boundary.scope_confirmation_required && (
                        <>
                          <Text size="xs" c="dimmed">
                            {t("depreciationBudgetScopeConfirmationHint")}
                          </Text>
                          <Select
                            label={t("depreciationBudgetScopeConfirmationLabel")}
                            data={[
                              {
                                value: "category",
                                label: t("depreciationBudgetScopeCategory"),
                              },
                              {
                                value: "all",
                                label: t("depreciationBudgetScopeAll"),
                              },
                            ]}
                            value={decision?.scope ?? null}
                            onChange={(scope) =>
                              updateDecision(boundary, {
                                scope:
                                  scope === "category" || scope === "all"
                                    ? scope
                                    : undefined,
                              })
                            }
                            required
                          />
                        </>
                      )}
                      {boundary.required_action === "order" ? (
                        <Select
                          label={t("depreciationBudgetBoundaryOrder")}
                          data={[
                            {
                              value: "before",
                              label: t("depreciationBudgetDecisionOrderBefore"),
                            },
                            {
                              value: "after",
                              label: t("depreciationBudgetDecisionOrderAfter"),
                            },
                          ]}
                          value={decision?.same_day_order ?? null}
                          onChange={(order) =>
                            updateDecision(boundary, {
                              same_day_order:
                                order === "before" || order === "after"
                                  ? order
                                  : undefined,
                            })
                          }
                          required
                        />
                      ) : null}
                      {actionKind && (
                        <Select
                          label={t("depreciationBudgetBoundaryDecision")}
                          data={actionOptions}
                          value={decision?.action ?? null}
                          onChange={(action) => {
                            if (
                              action === "continue" ||
                              action === "end" ||
                              action === "carry" ||
                              action === "settle"
                            ) {
                              updateDecision(boundary, {
                                action,
                                settlement_source_category_id:
                                  action === "settle"
                                    ? decision?.settlement_source_category_id ?? null
                                    : undefined,
                              });
                            }
                          }}
                          required
                        />
                      )}
                      {decision?.action === "settle" && (
                        <Select
                          label={t("depreciationBudgetResetSettlementSource")}
                          data={settlementSourceOptions}
                          value={
                            decision.settlement_source_category_id == null
                              ? "U"
                              : String(decision.settlement_source_category_id)
                          }
                          onChange={(source) =>
                            updateDecision(boundary, {
                              settlement_source_category_id:
                                source && source !== "U"
                                  ? Number(source)
                                  : null,
                            })
                          }
                          required
                        />
                      )}
                      {settings.method === "special" &&
                        decision?.action === "carry" && (
                          <Text size="xs" c="dimmed">
                            {t("depreciationBudgetResetCarryHint")}
                          </Text>
                        )}
                    </Stack>
                  </Paper>
                );
              })}
            </Stack>
          )}

          {error && <Alert color="red">{error}</Alert>}
          {previewStale && (
            <Alert color="yellow">{t("depreciationBudgetPreviewStale")}</Alert>
          )}

          {preview && (
            <Stack gap="sm">
              <Divider />
              <Title order={4}>{t("depreciationBudgetPreviewTitle")}</Title>
              {!preview.can_apply && (
                <Alert color="yellow">
                  {t("depreciationBudgetPreviewNotApplicable")}
                </Alert>
              )}
              {preview.warnings.map((warning, index) => (
                <Alert key={`${warning}-${index}`} color="yellow">
                  {PREVIEW_WARNING_TRANSLATIONS[warning]
                    ? t(PREVIEW_WARNING_TRANSLATIONS[warning] as never)
                    : warning}
                </Alert>
              ))}
              <Paper withBorder p="sm">
                <Stack gap="xs">
                  <Text size="sm" fw={600}>{t("depreciationBudgetProgressTitle")}</Text>
                  <SimpleGrid cols={{ base: 2, sm: 4 }}>
                    <Text size="xs">{t("depreciationBudgetTargetLabel")}: {formatCurrency(preview.progress.target_amount, locale, previewCurrency)}</Text>
                    <Text size="xs">{t("depreciationBudgetReimbursedLabel")}: {formatCurrency(preview.progress.reimbursed_amount, locale, previewCurrency)}</Text>
                    <Text size="xs">{t("depreciationBudgetRemainingLabel")}: {formatCurrency(preview.progress.remaining_amount, locale, previewCurrency)}</Text>
                    <Text size="xs">{t("depreciationBudgetFutureLabel")}: {formatCurrency(preview.progress.future_amount, locale, previewCurrency)}</Text>
                  </SimpleGrid>
                </Stack>
              </Paper>
              {preview.timeline.length > 0 && (
                <Stack gap="xs">
                  <Text size="sm" fw={600}>{t("depreciationBudgetTimelineBefore")} / {t("depreciationBudgetTimelineAfter")}</Text>
                  <Table.ScrollContainer minWidth={600}>
                    <Table withTableBorder withColumnBorders striped>
                      <Table.Thead>
                        <Table.Tr>
                          <Table.Th>{t("thDate")}</Table.Th>
                          <Table.Th>{t("depreciationBudgetTimelineBefore")}</Table.Th>
                          <Table.Th>{t("depreciationBudgetTimelineAfter")}</Table.Th>
                        </Table.Tr>
                      </Table.Thead>
                      <Table.Tbody>
                        {preview.timeline.map((item, index) => (
                          <Table.Tr key={`${item.date}-${index}`}>
                            <Table.Td>
                              <Text size="xs" fw={600}>{item.date}</Text>
                              <Text size="xs" c="dimmed">
                                {TIMELINE_LABEL_TRANSLATIONS[item.label]
                                  ? t(TIMELINE_LABEL_TRANSLATIONS[item.label] as never)
                                  : item.label}
                              </Text>
                              {item.created_at && (
                                <Text size="xs" c="dimmed">
                                  {t("depreciationBudgetTimelineTimestamp")}: {dayjs(item.created_at).isValid() ? dayjs(item.created_at).format("HH:mm:ss.SSS") : item.created_at}
                                </Text>
                              )}
                              {item.reset_log_id != null && (
                                <Text size="xs" c="dimmed">
                                  {t("depreciationBudgetTimelineResetId")}: {item.reset_log_id}
                                </Text>
                              )}
                            </Table.Td>
                            <Table.Td>{renderSnapshot(item.before)}</Table.Td>
                            <Table.Td>{renderSnapshot(item.after)}</Table.Td>
                          </Table.Tr>
                        ))}
                      </Table.Tbody>
                    </Table>
                  </Table.ScrollContainer>
                </Stack>
              )}
              <Stack gap="xs">
                <Text size="sm" fw={600}>{t("depreciationBudgetPreviewEventsTitle")}</Text>
                {preview.changes.length === 0 ? (
                  <Text size="xs" c="dimmed">{t("depreciationBudgetPreviewNoEvents")}</Text>
                ) : (
                  <Table.ScrollContainer minWidth={600}>
                    <Table withTableBorder withColumnBorders striped>
                      <Table.Thead>
                        <Table.Tr>
                          <Table.Th>{t("thDate")}</Table.Th>
                          <Table.Th>{t("thStatus")}</Table.Th>
                          <Table.Th>{t("depreciationBudgetSettlementSource")}</Table.Th>
                          <Table.Th>{t("depreciationBudgetDestinationCategory")}</Table.Th>
                          <Table.Th className="currency-cell">{t("amountLabel")}</Table.Th>
                        </Table.Tr>
                      </Table.Thead>
                      <Table.Tbody>
                        {preview.changes.map((change, index) => {
                          const event = change.event;
                          const eventLabel =
                            event.kind === "purchase"
                              ? t("depreciationBudgetEventPurchase")
                              : event.kind === "monthly"
                                ? t("depreciationBudgetEventMonthly")
                                : event.kind === "routing"
                                  ? t("depreciationBudgetEventRouting")
                                : event.kind === "carry"
                                  ? t("depreciationBudgetEventCarry")
                                  : t("depreciationBudgetEventSettlement");
                          const operation =
                            change.operation === "add"
                              ? t("depreciationBudgetOperationAdd")
                              : change.operation === "change"
                                ? t("depreciationBudgetOperationChange")
                                : t("depreciationBudgetOperationCancel");
                          const sourceName =
                            event.source_category_id == null
                              ? t("depreciationBudgetUnallocatedSource")
                              : budgetCategories.find(
                                  (category) => category.id === event.source_category_id,
                                )?.name ?? String(event.source_category_id);
                          const destinationName =
                            event.destination_category_id == null
                              ? "—"
                              : budgetCategories.find(
                                  (category) => category.id === event.destination_category_id,
                                )?.name ?? String(event.destination_category_id);
                          return (
                            <Table.Tr key={`${event.key}-${index}`}>
                              <Table.Td>{event.date}</Table.Td>
                              <Table.Td>{operation} · {eventLabel}</Table.Td>
                              <Table.Td>{sourceName}</Table.Td>
                              <Table.Td>{destinationName}</Table.Td>
                              <Table.Td className="currency-cell">
                                {formatCurrency(event.amount, locale, previewCurrency)}
                              </Table.Td>
                            </Table.Tr>
                          );
                        })}
                      </Table.Tbody>
                    </Table>
                  </Table.ScrollContainer>
                )}
              </Stack>
            </Stack>
          )}

          <Group justify="space-between">
            <Button variant="default" onClick={onClose}>{t("cancel")}</Button>
            <Group>
              <Button onClick={() => void handlePreview()} loading={previewLoading}>
                {t("depreciationBudgetPreviewButton")}
              </Button>
              <Button
                color="teal"
                disabled={!preview?.can_apply || previewStale}
                onClick={() => setApplyConfirmOpened(true)}
              >
                {t("depreciationBudgetApplyButton")}
              </Button>
            </Group>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={applyConfirmOpened}
        onClose={() => setApplyConfirmOpened(false)}
        title={t("depreciationBudgetApplyConfirmTitle")}
        centered
        size="sm"
      >
        <Stack>
          <Text size="sm">{t("depreciationBudgetApplyConfirmMessage")}</Text>
          <Group justify="flex-end">
            <Button
              variant="default"
              onClick={() => setApplyConfirmOpened(false)}
              disabled={applyLoading}
            >
              {t("cancel")}
            </Button>
            <Button
              color="teal"
              loading={applyLoading}
              onClick={() => void handleApply()}
            >
              {t("confirm")}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}
