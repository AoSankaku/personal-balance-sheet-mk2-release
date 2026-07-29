import {
  Badge,
  Button,
  Group,
  Modal,
  Paper,
  Radio,
  Stack,
  Text,
} from "@mantine/core";
import { useCallback, useEffect, useState } from "react";
import type {
  IncomeTransferHistoricalCandidate,
  IncomeTransferRequirementGroup,
  JournalEntry,
} from "@balance-sheet/shared";
import { api, ApiError } from "../api/client";
import { useLang } from "../i18n";
import { formatCurrency } from "../lib/numberFormat";
import { showFeedback } from "../lib/feedback";

export function IncomeTransferTasks() {
  const { t, locale } = useLang();
  const [groups, setGroups] = useState<IncomeTransferRequirementGroup[]>([]);
  const [completedGroups, setCompletedGroups] = useState<
    IncomeTransferRequirementGroup[]
  >([]);
  const [historical, setHistorical] = useState<
    IncomeTransferHistoricalCandidate[]
  >([]);
  const [historicalTargets, setHistoricalTargets] = useState<
    Record<string, number>
  >({});
  const [candidates, setCandidates] = useState<
    Array<JournalEntry & { has_budget_adjustment_logs: boolean }>
  >([]);
  const [candidateGroup, setCandidateGroup] =
    useState<IncomeTransferRequirementGroup | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [pending, completed, historicalCandidates] = await Promise.all([
        api.incomeTransferRequirements.list("pending"),
        api.incomeTransferRequirements.list("completed"),
        api.incomeTransferRequirements.historical(),
      ]);
      setGroups(pending.groups);
      setCompletedGroups(completed.groups);
      setHistorical(historicalCandidates);
    } catch {
      setGroups([]);
      setCompletedGroups([]);
      setHistorical([]);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function run(action: () => Promise<unknown>) {
    setLoading(true);
    try {
      await action();
      await refresh();
    } catch (error) {
      showFeedback({
        color: "red",
        message: error instanceof ApiError ? error.message : String(error),
      });
    } finally {
      setLoading(false);
    }
  }

  async function openCandidates(group: IncomeTransferRequirementGroup) {
    setLoading(true);
    try {
      setCandidates(
        await api.incomeTransferRequirements.candidates(
          group.requirement_ids[0]!,
        ),
      );
      setCandidateGroup(group);
    } catch (error) {
      showFeedback({
        color: "red",
        message: error instanceof ApiError ? error.message : String(error),
      });
    } finally {
      setLoading(false);
    }
  }

  async function linkCandidate(
    entry: JournalEntry & { has_budget_adjustment_logs: boolean },
  ) {
    if (!candidateGroup) return;
    if (
      entry.has_budget_adjustment_logs &&
      !window.confirm(t("incomeTransferLinkedBudgetWarning"))
    ) {
      return;
    }
    await run(() =>
      api.incomeTransferRequirements.link(
        candidateGroup.requirement_ids[0]!,
        entry.id,
        entry.has_budget_adjustment_logs,
      ),
    );
    setCandidateGroup(null);
    setCandidates([]);
  }

  async function registerHistorical(
    candidate: IncomeTransferHistoricalCandidate,
  ) {
    const key = `${candidate.source_income_journal_entry_id}:${candidate.budget_category_id}`;
    const targetId =
      historicalTargets[key] ??
      (candidate.target_accounts.length === 1
        ? candidate.target_accounts[0]!.id
        : null);
    if (
      targetId == null ||
      !window.confirm(t("incomeTransferHistoricalConfirm"))
    ) {
      return;
    }
    await run(() =>
      api.incomeTransferRequirements.register({
        source_income_journal_entry_id:
          candidate.source_income_journal_entry_id,
        destinations: [{
          budget_category_id: candidate.budget_category_id,
          from_account_id: candidate.from_account_id,
          to_account_id: targetId,
          amount: candidate.amount,
          currency: candidate.currency,
        }],
      }),
    );
  }

  if (
    groups.length === 0 &&
    completedGroups.length === 0 &&
    historical.length === 0
  ) {
    return null;
  }

  return (
    <>
      <Paper withBorder p="md">
        <Stack gap="sm">
          <Text fw={700}>{t("incomeTransferTasksTitle")}</Text>
          {groups.length === 0 && (
            <Text size="sm" c="dimmed">
              {t("incomeTransferNoTasks")}
            </Text>
          )}
          {groups.map((group) => (
            <Group
              key={group.key}
              justify="space-between"
              align="center"
              wrap="wrap"
            >
              <Stack gap={2}>
                <Text size="sm" fw={600}>
                  {group.requirements[0]?.source_income_description ?? "-"}
                </Text>
                <Group gap="xs">
                  <Badge variant="light">
                    {group.requirements[0]?.from_account_name} →{" "}
                    {group.requirements[0]?.to_account_name}
                  </Badge>
                  <Text size="sm">
                    {formatCurrency(group.amount, locale, group.currency)}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {group.requirements
                      .map((requirement) => requirement.budget_category_name)
                      .join(" / ")}
                  </Text>
                </Group>
              </Stack>
              <Group gap="xs">
                <Button
                  size="xs"
                  variant="default"
                  loading={loading}
                  onClick={() => void openCandidates(group)}
                >
                  {t("incomeTransferFindExisting")}
                </Button>
                <Button
                  size="xs"
                  loading={loading}
                  onClick={() =>
                    void run(() =>
                      api.incomeTransferRequirements.complete(
                        group.requirement_ids[0]!,
                      ),
                    )
                  }
                >
                  {t("incomeTransferComplete")}
                </Button>
              </Group>
            </Group>
          ))}
          {completedGroups.map((group) => (
            <Group key={group.key} justify="space-between" wrap="wrap">
              <Text size="sm" c="dimmed">
                #{group.transfer_journal_entry_id}・
                {group.requirements[0]?.from_account_name} →{" "}
                {group.requirements[0]?.to_account_name}・
                {formatCurrency(group.amount, locale, group.currency)}
              </Text>
              <Button
                size="xs"
                color="red"
                variant="subtle"
                loading={loading}
                onClick={() =>
                  void run(() =>
                    api.incomeTransferRequirements.cancel(
                      group.requirement_ids[0]!,
                    ),
                  )
                }
              >
                {t("incomeTransferCancelCompletion")}
              </Button>
            </Group>
          ))}
          {historical.length > 0 && (
            <Stack gap="xs">
              <Text size="sm" fw={700}>
                {t("incomeTransferHistoricalTitle")}
              </Text>
              <Text size="xs" c="dimmed">
                {t("incomeTransferHistoricalHint")}
              </Text>
              {historical.map((candidate) => {
                const key = `${candidate.source_income_journal_entry_id}:${candidate.budget_category_id}`;
                return (
                  <Paper key={key} withBorder p="sm">
                    <Stack gap="xs">
                      <Text size="sm" fw={600}>
                        {candidate.source_income_date}・
                        {candidate.source_income_description}
                      </Text>
                      <Text size="xs">
                        {candidate.budget_category_name}・
                        {formatCurrency(
                          candidate.amount,
                          locale,
                          candidate.currency,
                        )}
                      </Text>
                      <Text size="xs" c="dimmed">
                        {candidate.from_account_name} →{" "}
                        {candidate.target_accounts.length === 1
                          ? candidate.target_accounts[0]!.name
                          : t("incomeTransferDestination")}
                      </Text>
                      {candidate.target_accounts.length > 1 && (
                        <Radio.Group
                          value={String(historicalTargets[key] ?? "")}
                          onChange={(value) =>
                            setHistoricalTargets((current) => ({
                              ...current,
                              [key]: Number(value),
                            }))
                          }
                        >
                          <Stack gap={4}>
                            {candidate.target_accounts.map((account) => (
                              <Radio
                                key={account.id}
                                value={String(account.id)}
                                label={account.name}
                              />
                            ))}
                          </Stack>
                        </Radio.Group>
                      )}
                      {candidate.target_accounts.length === 0 && (
                        <Text size="xs" c="orange">
                          {t("incomeTransferTargetMissing")}
                        </Text>
                      )}
                      <Button
                        size="xs"
                        variant="light"
                        loading={loading}
                        disabled={
                          candidate.target_accounts.length === 0 ||
                          (candidate.target_accounts.length > 1 &&
                            historicalTargets[key] == null)
                        }
                        onClick={() => void registerHistorical(candidate)}
                      >
                        {t("incomeTransferRegister")}
                      </Button>
                    </Stack>
                  </Paper>
                );
              })}
            </Stack>
          )}
        </Stack>
      </Paper>
      <Modal
        opened={candidateGroup != null}
        onClose={() => setCandidateGroup(null)}
        title={t("incomeTransferFindExisting")}
      >
        <Stack>
          {candidates.length === 0 ? (
            <Text size="sm" c="dimmed">
              {t("incomeTransferNoTasks")}
            </Text>
          ) : (
            candidates.map((entry) => (
              <Group key={entry.id} justify="space-between">
                <Stack gap={0}>
                  <Text size="sm">{entry.description}</Text>
                  <Text size="xs" c="dimmed">
                    {entry.date}・#{entry.id}
                  </Text>
                </Stack>
                <Button size="xs" onClick={() => void linkCandidate(entry)}>
                  {t("incomeTransferFindExisting")}
                </Button>
              </Group>
            ))
          )}
        </Stack>
      </Modal>
    </>
  );
}
