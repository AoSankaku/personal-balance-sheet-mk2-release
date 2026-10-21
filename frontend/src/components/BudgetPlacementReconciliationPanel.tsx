import { useEffect, useState } from "react";
import { Accordion, Alert, Button, Group, Loader, Modal, Paper, Stack, Text } from "@mantine/core";
import { IconAlertTriangle, IconArrowsExchange } from "@tabler/icons-react";
import type { BudgetPlacementReconciliation, IncomeTransferRequirementGroup } from "@balance-sheet/shared";
import { useAppData } from "../context/AppDataContext";
import { useLang } from "../i18n";
import { accountDisplayNameFromName } from "../lib/accountUtils";
import { formatCurrency } from "../lib/numberFormat";
import { showFeedback } from "../lib/feedback";
import { api, ApiError } from "../api/client";
import { useBudgetPlacementReconciliation } from "../hooks/useBudgetPlacementReconciliation";
import { partitionIncomeTransfers } from "../lib/incomeTransferScheduling";

function signed(value: number, locale: string, currency: string, decimalPlaces?: number) {
  return `${value >= 0 ? "+" : ""}${formatCurrency(value, locale, currency, undefined, decimalPlaces)}`;
}

export function BudgetPlacementReconciliationPanel({
  showExecute = false,
  onCompleted,
}: { showExecute?: boolean; onCompleted?: () => Promise<void> }) {
  const { t, locale } = useLang();
  const { refresh: refreshAppData, accountsToday, enabledCurrencies, displayCurrency, budgetSettings, loading: appDataLoading } = useAppData();
  const { plan, loading, error, refresh } = useBudgetPlacementReconciliation();
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<BudgetPlacementReconciliation | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [deferralSubmitting, setDeferralSubmitting] = useState(false);
  const decimalPlaces = (currency: string) => enabledCurrencies.find(item => item.code.toUpperCase() === currency.toUpperCase())?.decimal_places;
  const incomeTransferPartition = partitionIncomeTransfers({
    groups: plan?.pending_transfers ?? [],
    settings: budgetSettings?.income_transfer_settings,
  });
  const deferredGroupKeys = new Set(incomeTransferPartition.deferred.map(group => group.key));

  useEffect(() => {
    if (selectedPlan && selectedPlan.currency.toUpperCase() !== (displayCurrency || "JPY").toUpperCase()) {
      setSelectedPlan(null);
      setConfirmationOpen(false);
    }
  }, [displayCurrency, selectedPlan]);

  async function completePlan() {
    const snapshot = selectedPlan;
    if (!snapshot) return;
    setSubmitting(true);
    try {
      await api.incomeTransferRequirements.placementComplete({
        currency: snapshot.currency,
        token: snapshot.token,
        description: t("budgetPlacementTransferJournalDescription"),
      });
      await Promise.all([refreshAppData(), refresh(), onCompleted?.()]);
      setConfirmationOpen(false);
      setSelectedPlan(null);
      showFeedback({ message: t("budgetPlacementTransferRecorded"), color: "teal" });
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409) {
        try { await Promise.all([refreshAppData(), refresh()]); } catch { /* the refreshed panel shows its own error */ }
        setConfirmationOpen(false);
        setSelectedPlan(null);
        showFeedback({ message: t("budgetPlacementPlanStale"), color: "orange" });
      } else {
        showFeedback({ message: cause instanceof Error ? cause.message : String(cause), color: "red" });
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleIncomeTransferDeferral(group: IncomeTransferRequirementGroup, isDeferred: boolean) {
    setDeferralSubmitting(true);
    try {
      await Promise.all(group.requirement_ids.map(id =>
        api.incomeTransferRequirements.defer(id, !isDeferred),
      ));
      await Promise.all([refreshAppData(), refresh(), onCompleted?.()]);
      showFeedback({
        message: isDeferred
          ? t("incomeTransferResumeAction")
          : t("incomeTransferDeferredTitle").replace("{count}", "1"),
        color: "teal",
      });
    } catch (cause) {
      showFeedback({ message: cause instanceof Error ? cause.message : String(cause), color: "red" });
    } finally {
      setDeferralSubmitting(false);
    }
  }

  return (
    <>
      <Paper withBorder p="md" radius="md">
        <Stack gap="sm">
          <Group justify="space-between" align="center">
            <Text fw={700}>{t("budgetPlacementReconciliationTitle")}</Text>
            {loading && <Loader size="xs" aria-label={t("budgetPlacementPlanLoading")} />}
          </Group>
          {error && (
            <Alert color="orange" icon={<IconAlertTriangle size={16} />} title={t("budgetPlacementPlanUnavailable")}>
              <Text size="sm">{t("budgetPlacementPlanUnavailableHint")}</Text>
              <Button mt="xs" size="xs" variant="light" onClick={() => void refresh().catch(() => undefined)}>
                {t("reload")}
              </Button>
            </Alert>
          )}
          {plan && <ReconciliationDetails plan={plan} showExecute={showExecute} actionDisabled={loading || appDataLoading || submitting || deferralSubmitting} deferredGroupKeys={deferredGroupKeys} deferredIncomeTransferCount={incomeTransferPartition.deferred.length} onToggleDeferred={toggleIncomeTransferDeferral} onExecute={() => {
            setSelectedPlan(plan);
            setConfirmationOpen(true);
          }} />}
        </Stack>
      </Paper>
      <Modal
        opened={confirmationOpen && selectedPlan != null}
        onClose={() => { if (!submitting) setConfirmationOpen(false); }}
        title={t("budgetPlacementTransferConfirmTitle")}
        size="md"
        centered
      >
        <Stack gap="sm">
          <Text size="sm">{t("budgetPlacementTransferConfirmHint")}</Text>
          <Text size="xs" c="dimmed">{selectedPlan?.as_of}</Text>
          {(selectedPlan?.pending_transfers.length ?? 0) > 0 && (
            <Stack gap={4}>
              <Text size="sm" fw={600}>{t("budgetPlacementPendingIncomeTitle")}</Text>
              {selectedPlan!.pending_transfers.flatMap(group => group.requirements
                .filter(requirement => !selectedPlan!.unresolved_requirement_ids.includes(requirement.id))
                .map(requirement => (
                <Text key={requirement.id} size="sm">
                  {requirement.from_account_name} → {requirement.to_account_name}・{formatCurrency(requirement.amount, locale, requirement.currency, undefined, decimalPlaces(requirement.currency))}
                </Text>
              )))}
            </Stack>
          )}
          {selectedPlan && selectedPlan.transfers.length > 0 && (
            <Text size="sm" fw={600}>{t("budgetPlacementPlanTransfersTitle")}</Text>
          )}
          {selectedPlan?.transfers.map((transfer, index) => (
            <Text key={`${transfer.currency}:${transfer.from_account_id}:${transfer.to_account_id}:${index}`} size="sm">
              {accountDisplayNameFromName(accountName(selectedPlan, accountsToday, transfer.from_account_id), t)} → {accountDisplayNameFromName(accountName(selectedPlan, accountsToday, transfer.to_account_id), t)}・{formatCurrency(transfer.amount, locale, transfer.currency, undefined, decimalPlaces(transfer.currency))}
            </Text>
          ))}
          <Group justify="flex-end" mt="xs">
            <Button variant="default" disabled={submitting} onClick={() => setConfirmationOpen(false)}>{t("cancel")}</Button>
            <Button color="teal" loading={submitting} disabled={loading || appDataLoading} onClick={() => void completePlan()}>{t("budgetPlacementTransferRecordAction")}</Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}

function ReconciliationDetails({
  plan,
  showExecute,
  actionDisabled,
  deferredGroupKeys,
  deferredIncomeTransferCount,
  onToggleDeferred,
  onExecute,
}: {
  plan: BudgetPlacementReconciliation;
  showExecute: boolean;
  actionDisabled: boolean;
  deferredGroupKeys: Set<string>;
  deferredIncomeTransferCount: number;
  onToggleDeferred: (group: IncomeTransferRequirementGroup, isDeferred: boolean) => void;
  onExecute: () => void;
}) {
  const { t, locale } = useLang();
  const { accountsToday, displayCurrency, enabledCurrencies } = useAppData();
  const currency = plan.currency || displayCurrency || "JPY";
  const pending = plan.pending_transfers;
  const hasPlanWork = plan.transfers.length > 0 || plan.requirement_ids.some(id => !plan.unresolved_requirement_ids.includes(id));
  const decimals = (code: string) => enabledCurrencies.find(item => item.code.toUpperCase() === code.toUpperCase())?.decimal_places;
  const format = (amount: number) => formatCurrency(amount, locale, currency, undefined, decimals(currency));

  return (
    <Stack gap="sm">
      <Text size="xs" c="dimmed">{t("budgetPlacementPlanAsOf").replace("{date}", plan.as_of)}</Text>
      <Group gap="xs" wrap="wrap">
        <Text size="sm">{t("budgetPlacementPlanCurrentGap")}: <strong>{signed(plan.total_difference, locale, currency, decimals(currency))}</strong></Text>
        <Text size="sm">{t("budgetPlacementPlanAfterTransfers")}: <strong>{signed(plan.after_total_difference, locale, currency, decimals(currency))}</strong></Text>
        <Text size="sm">{t("budgetPlacementPlanAfterCardDebt")}: <strong>{signed(plan.adjusted_total_difference, locale, currency, decimals(currency))}</strong></Text>
      </Group>

      {plan.unresolved_requirement_ids.length > 0 && (
        <Text size="sm" c="orange">{t("budgetPlacementUnresolvedIncomeTransferHint").replace("{count}", String(plan.unresolved_requirement_ids.length))}</Text>
      )}

      {pending.length > 0 && (
        <Stack gap={4}>
          <Text size="sm" fw={600}>{t("budgetPlacementPendingIncomeTitle")}</Text>
          {pending.map(group => {
            const isDeferred = deferredGroupKeys.has(group.key);
            return (
              <Group key={group.key} justify="space-between" align="flex-start" wrap="wrap">
                <Stack gap={2} style={{ flex: 1, minWidth: 200 }}>
                  {group.requirements.map(requirement => (
                    <Text key={requirement.id} size="sm">
                      {requirement.source_income_date}・{requirement.source_income_description}: {requirement.from_account_name} → {requirement.to_account_name}・{formatCurrency(requirement.amount, locale, requirement.currency, undefined, decimals(requirement.currency))}
                    </Text>
                  ))}
                </Stack>
                {showExecute && (
                  <Button size="xs" variant="subtle" disabled={actionDisabled} onClick={() => onToggleDeferred(group, isDeferred)}>
                    {t(isDeferred ? "incomeTransferResumeAction" : "incomeTransferDeferAction")}
                  </Button>
                )}
              </Group>
            );
          })}
          {deferredIncomeTransferCount > 0 && (
            <Text size="xs" c="dimmed">{t("incomeTransferDeferredHint")}</Text>
          )}
        </Stack>
      )}

      {plan.expense_evidence.length > 0 && (
        <Accordion variant="contained" radius="md">
          <Accordion.Item value="expense-evidence">
            <Accordion.Control>{t("budgetPlacementExpenseEvidenceTitle").replace("{count}", String(plan.expense_evidence.length))}</Accordion.Control>
            <Accordion.Panel>
              <Stack gap="xs">
                <Text size="xs" c="dimmed">{t("budgetPlacementExpenseEvidenceHint")}</Text>
                {plan.expense_evidence.map(item => (
                  <Text key={`${item.journal_entry_id}:${item.budget_category_id}`} size="sm">
                    #{item.journal_entry_id}・{item.date}・{item.description}: {item.from_account_name} → {displayGroupName(plan, item.to_group_id, t)}・{item.budget_category_name}・{format(item.amount)}
                  </Text>
                ))}
              </Stack>
            </Accordion.Panel>
          </Accordion.Item>
        </Accordion>
      )}

      {plan.transfers.length > 0 ? (
        <Stack gap="xs">
          <Text size="sm" fw={600}>{t("budgetPlacementPlanTransfersTitle")}</Text>
          {plan.transfers.map((transfer, index) => (
            <Group key={`${transfer.currency}:${transfer.from_account_id}:${transfer.to_account_id}:${index}`} gap="xs" wrap="nowrap">
              <IconArrowsExchange size={16} aria-hidden="true" />
              <Text size="sm">{accountDisplayNameFromName(accountName(plan, accountsToday, transfer.from_account_id), t)} → {accountDisplayNameFromName(accountName(plan, accountsToday, transfer.to_account_id), t)}・{formatCurrency(transfer.amount, locale, transfer.currency, undefined, decimals(transfer.currency))}</Text>
            </Group>
          ))}
        </Stack>
      ) : (
        <Text size="sm" c="dimmed">{t("budgetPlacementNoCashTransfers")}</Text>
      )}

      {showExecute && hasPlanWork && (
        <Button size="sm" variant="light" color="teal" disabled={actionDisabled} onClick={onExecute}>
          {t("budgetPlacementTransferRecordAction")}
        </Button>
      )}
      <Text size="xs" c="dimmed">
        {t("budgetPlacementPlanTotalsHint").replace("{liabilities}", plan.liabilities.map(item => `${accountDisplayNameFromName(item.account_name, t)} ${format(item.amount)}`).join("、") || format(0))}
      </Text>
      {plan.groups.some(group => group.retained_shortage > 0) && (
        <Text size="xs" c="dimmed">{t("budgetPlacementRetainedOverspendingHint")}</Text>
      )}
    </Stack>
  );
}

function displayGroupName(plan: BudgetPlacementReconciliation, id: string, t: ReturnType<typeof useLang>["t"]) {
  const group = plan.groups.find(candidate => candidate.group_id === id);
  if (!group) return t("budgetPlacementPlanGroupLabel").replace("{id}", "—");
  return group.account_names.map(name => accountDisplayNameFromName(name, t)).join(" + ");
}

function accountName(plan: BudgetPlacementReconciliation, accounts: ReturnType<typeof useAppData>["accountsToday"], id: number) {
  return accounts.find(account => account.id === id)?.name
    ?? plan.groups.flatMap(group => group.accounts).find(account => account.account_id === id)?.account_name
    ?? plan.pending_transfers.flatMap(group => group.requirements).find(requirement => requirement.from_account_id === id)?.from_account_name
    ?? plan.pending_transfers.flatMap(group => group.requirements).find(requirement => requirement.to_account_id === id)?.to_account_name
    ?? `#${id}`;
}
