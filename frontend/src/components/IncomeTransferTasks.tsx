import {
  Accordion,
  Badge,
  Button,
  Group,
  Loader,
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
  IncomeTransferSquashPreview,
  JournalEntry,
} from "@balance-sheet/shared";
import { api, ApiError } from "../api/client";
import { useAppData } from "../context/AppDataContext";
import { useLang } from "../i18n";
import { formatCurrency } from "../lib/numberFormat";
import { showFeedback } from "../lib/feedback";
import { ConfirmModal } from "./ConfirmModal";

type TransferCandidate = JournalEntry & {
  has_budget_adjustment_logs: boolean;
};

interface HistoricalRegistrationConfirmation {
  candidate: IncomeTransferHistoricalCandidate;
  targetId: number;
}

interface IncomeTransferTasksProps {
  showEmpty?: boolean;
  showTitle?: boolean;
}

export function IncomeTransferTasks({
  showEmpty = false,
  showTitle = true,
}: IncomeTransferTasksProps) {
  const { t, locale } = useLang();
  const { refresh: refreshAppData } = useAppData();
  const [groups, setGroups] = useState<IncomeTransferRequirementGroup[]>([]);
  const [completedGroups, setCompletedGroups] = useState<
    IncomeTransferRequirementGroup[]
  >([]);
  const [historical, setHistorical] = useState<
    IncomeTransferHistoricalCandidate[]
  >([]);
  const [squashPreview, setSquashPreview] =
    useState<IncomeTransferSquashPreview | null>(null);
  const [historicalTargets, setHistoricalTargets] = useState<
    Record<string, number>
  >({});
  const [candidates, setCandidates] = useState<TransferCandidate[]>([]);
  const [candidateGroup, setCandidateGroup] =
    useState<IncomeTransferRequirementGroup | null>(null);
  const [linkConfirmation, setLinkConfirmation] =
    useState<TransferCandidate | null>(null);
  const [historicalConfirmation, setHistoricalConfirmation] =
    useState<HistoricalRegistrationConfirmation | null>(null);
  const [squashConfirmation, setSquashConfirmation] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [pending, completed, historicalCandidates, nextSquashPreview] =
        await Promise.all([
          api.incomeTransferRequirements.list("pending"),
          api.incomeTransferRequirements.list("completed"),
          api.incomeTransferRequirements.historical(),
          api.incomeTransferRequirements.squashPreview(),
        ]);
      setGroups(pending.groups);
      setCompletedGroups(completed.groups);
      setHistorical(historicalCandidates);
      setSquashPreview(nextSquashPreview);
    } catch {
      setGroups([]);
      setCompletedGroups([]);
      setHistorical([]);
      setSquashPreview(null);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void refresh().finally(() => {
      if (active) setInitialLoading(false);
    });
    return () => {
      active = false;
    };
  }, [refresh]);

  async function run(action: () => Promise<unknown>) {
    setLoading(true);
    try {
      await action();
      await Promise.all([refresh(), refreshAppData()]);
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

  async function performLinkCandidate(entry: TransferCandidate) {
    if (!candidateGroup) return;
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

  function linkCandidate(entry: TransferCandidate) {
    if (!candidateGroup) return;
    setLinkConfirmation(entry);
  }

  function registerHistorical(
    candidate: IncomeTransferHistoricalCandidate,
  ) {
    const key = `${candidate.source_income_journal_entry_id}:${candidate.budget_category_id}`;
    const targetId =
      historicalTargets[key] ??
      (candidate.target_accounts.length === 1
        ? candidate.target_accounts[0]!.id
        : null);
    if (targetId == null) return;
    setHistoricalConfirmation({ candidate, targetId });
  }

  async function performHistoricalRegistration({
    candidate,
    targetId,
  }: HistoricalRegistrationConfirmation) {
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
    !initialLoading &&
    !showEmpty &&
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
          {showTitle && (
            <Text fw={700}>{t("incomeTransferTasksTitle")}</Text>
          )}
          {initialLoading && (
            <Group justify="center" gap="xs" py="sm" role="status">
              <Loader size="xs" aria-hidden="true" />
              <Text size="sm" c="dimmed">
                {t("incomeTransferLoading")}
              </Text>
            </Group>
          )}
          {!initialLoading && groups.length === 0 && (
            <Text size="sm" c="dimmed">
              {t("incomeTransferNoTasks")}
            </Text>
          )}
          {squashPreview != null &&
            squashPreview.original_transfer_count >
              squashPreview.squashed_transfer_count && (
              <Paper
                withBorder
                p="sm"
                bg="var(--mantine-color-blue-light)"
              >
                <Stack gap="xs">
                  <Text size="sm" fw={700}>
                    {t("incomeTransferSquashTitle")}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {t("incomeTransferSquashHint")
                      .replace(
                        "{before}",
                        String(squashPreview.original_transfer_count),
                      )
                      .replace(
                        "{after}",
                        String(squashPreview.squashed_transfer_count),
                      )}
                  </Text>
                  {squashPreview.transfers.length === 0 ? (
                    <Text size="sm" fw={600}>
                      {t("incomeTransferSquashNoTransfer")}
                    </Text>
                  ) : (
                    <Stack gap={2}>
                      {squashPreview.transfers.map((transfer, index) => (
                        <Text
                          key={`${transfer.currency}:${transfer.from_account_id}:${transfer.to_account_id}:${index}`}
                          size="sm"
                        >
                          {transfer.from_account_name} → {transfer.to_account_name}
                          ・{formatCurrency(transfer.amount, locale, transfer.currency)}
                        </Text>
                      ))}
                    </Stack>
                  )}
                  <Button
                    size="xs"
                    variant="light"
                    loading={loading}
                    onClick={() => setSquashConfirmation(true)}
                  >
                    {t("incomeTransferSquashAction")}
                  </Button>
                </Stack>
              </Paper>
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
                        t("incomeTransferJournalDescription").replace(
                          "{description}",
                          group.requirements[0]?.source_income_description ?? "-",
                        ),
                      ),
                    )
                  }
                >
                  {t("incomeTransferComplete")}
                </Button>
              </Group>
            </Group>
          ))}
          {completedGroups.length > 0 && (
            <Accordion defaultValue={null} variant="contained" radius="md">
              <Accordion.Item value="completed">
                <Accordion.Control>
                  <Text size="sm" fw={600} c="dimmed">
                    {t("incomeTransferCompletedAccordion").replace(
                      "{count}",
                      String(completedGroups.length),
                    )}
                  </Text>
                </Accordion.Control>
                <Accordion.Panel>
                  <Stack gap="xs">
                    {completedGroups.map((group) => (
                      <Group
                        key={group.key}
                        justify="space-between"
                        wrap="wrap"
                      >
                        <Text size="sm" c="dimmed">
                          {group.transfer_journal_entry_id != null
                            ? t("incomeTransferJournalReference").replace(
                                "{id}",
                                String(group.transfer_journal_entry_id),
                              )
                            : t("incomeTransferNettedReference")}
                          {group.is_squashed
                            ? `・${t("incomeTransferSquashedCompleted").replace(
                                "{count}",
                                String(group.requirement_ids.length),
                              )}`
                            : `・${group.requirements[0]?.from_account_name} → ${group.requirements[0]?.to_account_name}・${formatCurrency(
                                group.amount,
                                locale,
                                group.currency,
                              )}`}
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
                  </Stack>
                </Accordion.Panel>
              </Accordion.Item>
            </Accordion>
          )}
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
                        onClick={() => registerHistorical(candidate)}
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
        opened={candidateGroup != null && linkConfirmation == null}
        onClose={() => setCandidateGroup(null)}
        title={t("incomeTransferFindExisting")}
      >
        <Stack>
          {candidates.length === 0 ? (
            <Text size="sm" c="dimmed">
              {t("incomeTransferNoCandidates")}
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
                <Button size="xs" onClick={() => linkCandidate(entry)}>
                  {t("incomeTransferSelectCandidate")}
                </Button>
              </Group>
            ))
          )}
        </Stack>
      </Modal>
      <ConfirmModal
        opened={squashConfirmation}
        onClose={() => setSquashConfirmation(false)}
        onConfirm={() => {
          void run(() =>
            api.incomeTransferRequirements.squash(
              t("incomeTransferSquashJournalDescription").replace(
                "{count}",
                String(squashPreview?.squashed_transfer_count ?? 0),
              ),
            ),
          );
        }}
        title={t("incomeTransferSquashConfirmTitle")}
        message={t("incomeTransferSquashConfirm")}
        confirmLabel={t("incomeTransferSquashAction")}
        confirmColor="blue"
        loading={loading}
      />
      <ConfirmModal
        opened={linkConfirmation != null}
        onClose={() => setLinkConfirmation(null)}
        onConfirm={() => {
          if (linkConfirmation) void performLinkCandidate(linkConfirmation);
        }}
        title={t(
          linkConfirmation?.has_budget_adjustment_logs
            ? "incomeTransferLinkedBudgetConfirmTitle"
            : "incomeTransferLinkConfirmTitle",
        )}
        message={t(
          linkConfirmation?.has_budget_adjustment_logs
            ? "incomeTransferLinkedBudgetWarning"
            : "incomeTransferLinkConfirmMessage",
        )}
        confirmLabel={t("confirm")}
        confirmColor={
          linkConfirmation?.has_budget_adjustment_logs ? "orange" : "blue"
        }
        loading={loading}
      />
      <ConfirmModal
        opened={historicalConfirmation != null}
        onClose={() => setHistoricalConfirmation(null)}
        onConfirm={() => {
          if (historicalConfirmation) {
            void performHistoricalRegistration(historicalConfirmation);
          }
        }}
        title={t("incomeTransferHistoricalConfirmTitle")}
        message={t("incomeTransferHistoricalConfirm")}
        confirmLabel={t("incomeTransferRegister")}
        confirmColor="blue"
        loading={loading}
      />
    </>
  );
}
