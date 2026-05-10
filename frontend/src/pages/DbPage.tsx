import {
  Accordion,
  Anchor,
  Badge,
  Box,
  Button,
  Card,
  Divider,
  Group,
  Modal,
  Paper,
  Select,
  Stack,
  Text,
  ThemeIcon,
} from "@mantine/core";
import {
  IconArrowLeft,
  IconArrowNarrowDown,
  IconArrowNarrowUp,
  IconBuildingBank,
  IconCalendarStats,
  IconCheck,
  IconCoin,
  IconPencil,
} from "@tabler/icons-react";
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { JournalEntry } from "@balance-sheet/shared";
import {
  isLongTermBorrowingCategory,
  isLongTermLendingCategory,
  isShortTermBorrowingCategory,
  isShortTermLendingCategory,
} from "@balance-sheet/shared";
import { useLang } from "../i18n";
import { useAppData } from "../context/AppDataContext";
import { api } from "../api/client";
import { formatJPY } from "../lib/numberFormat";
import { isShortTermLoanAccountActive } from "./dbPageUtils";
import {
  type AccountOption,
  renderAccountOption,
} from "../components/SimpleEntryForm";
import { AppDataErrorAlert } from "../components/AppDataErrorAlert";
import {
  CATEGORY_TRANSLATION_KEY,
  categoryIndex,
  systemAccountTranslationKey,
} from "../lib/accountUtils";

interface LoanSection {
  titleKey:
    | "sectionShortTermLending"
    | "sectionLongTermLending"
    | "sectionShortTermLoan"
    | "sectionLongTermLoan";
  isLongTerm: boolean;
  isAsset: boolean;
  color: string;
  categoryFilter: (cat: string) => boolean;
}

const SECTIONS: LoanSection[] = [
  {
    titleKey: "sectionShortTermLending",
    isLongTerm: false,
    isAsset: true,
    color: "teal",
    categoryFilter: (c) => isShortTermLendingCategory(c as never),
  },
  {
    titleKey: "sectionLongTermLending",
    isLongTerm: true,
    isAsset: true,
    color: "blue",
    categoryFilter: (c) => isLongTermLendingCategory(c as never),
  },
  {
    titleKey: "sectionShortTermLoan",
    isLongTerm: false,
    isAsset: false,
    color: "orange",
    categoryFilter: (c) => isShortTermBorrowingCategory(c as never),
  },
  {
    titleKey: "sectionLongTermLoan",
    isLongTerm: true,
    isAsset: false,
    color: "red",
    categoryFilter: (c) => isLongTermBorrowingCategory(c as never),
  },
];

export default function DbPage() {
  const { t, locale } = useLang();
  const { accounts, journal, loading, error, refresh } = useAppData();
  const navigate = useNavigate();
  const [pendingSettle, setPendingSettle] = useState<{
    entry: JournalEntry;
    acct: ReturnType<typeof useAppData>["accounts"][number];
    netChange: number;
  } | null>(null);
  const [settleCounterAccountId, setSettleCounterAccountId] = useState<
    number | null
  >(null);

  const accountMap = useMemo(
    () => new Map(accounts.map((a) => [a.id, a])),
    [accounts],
  );

  const sectionData = useMemo(() => {
    return SECTIONS.map((sec) => {
      const sectionAccounts = accounts
        .filter((a) => sec.categoryFilter(a.category))
        .sort(
          (a, b) =>
            new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
        );

      const sectionAccountIds = new Set(sectionAccounts.map((a) => a.id));

      // All journal entries involving this section's accounts
      const allEntries = journal
        .filter((e) => e.lines.some((l) => sectionAccountIds.has(l.account_id)))
        .sort(
          (a, b) =>
            new Date(b.date).getTime() - new Date(a.date).getTime() ||
            b.id - a.id,
        );

      // Build per-account entries
      const entriesByAccount = new Map(
        sectionAccounts.map((acct) => {
          const acctEntries = allEntries
            .filter((e) => e.lines.some((l) => l.account_id === acct.id))
            .map((e) => {
              let netChange = 0;
              for (const l of e.lines) {
                if (l.account_id !== acct.id) continue;
                const a = accountMap.get(l.account_id);
                if (!a) continue;
                if (a.type === "asset" || a.type === "expense") {
                  netChange += l.debit - l.credit;
                } else {
                  netChange += l.credit - l.debit;
                }
              }
              return { entry: e, netChange };
            });
          return [acct.id, acctEntries] as const;
        }),
      );

      return { sec, accounts: sectionAccounts, entriesByAccount };
    });
  }, [accounts, journal, accountMap]);

  // Grouped account options for the write-off modal (mirrors SimpleEntryForm pattern)
  const counterAccountOptions = useMemo(() => {
    const buildGrouped = (type: "expense" | "income") => {
      const sorted = [...accounts.filter((a) => a.type === type)].sort(
        (a, b) => {
          const ai = categoryIndex(a.type, a.category, a.is_system ?? false);
          const bi = categoryIndex(b.type, b.category, b.is_system ?? false);
          return ai !== bi ? ai - bi : a.name.localeCompare(b.name, "ja");
        },
      );
      const groups = new Map<
        string,
        { group: string; items: AccountOption[] }
      >();
      for (const a of sorted) {
        const catKey = a.is_system
          ? "sysAccountBadge"
          : (CATEGORY_TRANSLATION_KEY[a.category] ?? "catOther");
        const groupLabel = a.is_system
          ? t("sysAccountBadge")
          : t(catKey as Parameters<typeof t>[0]);
        const groupId = a.is_system ? "__system__" : a.category;
        if (!groups.has(groupId)) {
          groups.set(groupId, { group: groupLabel, items: [] });
        }
        const label = (() => {
          if (a.is_system) {
            const k = systemAccountTranslationKey(a.name);
            if (k) return t(k);
          }
          return a.name;
        })();
        groups.get(groupId)!.items.push({
          value: String(a.id),
          label,
          category: a.category,
          is_system: a.is_system ?? false,
        });
      }
      return [...groups.values()];
    };
    return { expense: buildGrouped("expense"), income: buildGrouped("income") };
  }, [accounts, t]);

  function handleInputEntry(
    entry: JournalEntry,
    acct: ReturnType<typeof useAppData>["accounts"][number],
    netChange: number,
  ) {
    const isLending = isShortTermLendingCategory(acct.category as never);
    navigate("/input", {
      state: {
        loanDraft: {
          entryType: "loan",
          loanDirection: isLending ? "collect" : "decrease",
          loanAccountId: acct.id,
          amount: Math.abs(netChange),
          description: entry.description,
        },
        settledEntryIds: [entry.id],
        tab: "simple",
      },
    });
  }

  function handleForceSettleEntry(
    entry: JournalEntry,
    acct: ReturnType<typeof useAppData>["accounts"][number],
    netChange: number,
  ) {
    setPendingSettle({ entry, acct, netChange });
    setSettleCounterAccountId(null);
  }

  function closeWriteOffModal() {
    setPendingSettle(null);
    setSettleCounterAccountId(null);
  }

  async function handleConfirmSettle() {
    if (!pendingSettle || settleCounterAccountId === null) return;
    try {
      const { entry, acct } = pendingSettle;
      const today = new Date().toISOString().slice(0, 10);

      // Compute per-currency net amounts for this account from this entry
      const byCurrency = new Map<string, number>();
      for (const l of entry.lines) {
        if (l.account_id !== acct.id) continue;
        const cur = l.currency ?? "JPY";
        const change =
          acct.type === "asset" || acct.type === "expense"
            ? l.debit - l.credit
            : l.credit - l.debit;
        byCurrency.set(cur, (byCurrency.get(cur) ?? 0) + change);
      }

      const lines: {
        account_id: number;
        debit: number;
        credit: number;
        currency: string;
      }[] = [];
      for (const [cur, amount] of byCurrency) {
        if (amount <= 0) continue;
        if (acct.type === "asset" || acct.type === "expense") {
          // Lending write-off: DR expense / CR lending_account
          lines.push(
            {
              account_id: settleCounterAccountId,
              debit: amount,
              credit: 0,
              currency: cur,
            },
            {
              account_id: acct.id,
              debit: 0,
              credit: amount,
              currency: cur,
            },
          );
        } else {
          // Borrowing write-off: DR borrowing_account / CR income_account
          lines.push(
            {
              account_id: acct.id,
              debit: amount,
              credit: 0,
              currency: cur,
            },
            {
              account_id: settleCounterAccountId,
              debit: 0,
              credit: amount,
              currency: cur,
            },
          );
        }
      }

      await api.journal.create({
        date: today,
        description: `${t("loanForceSettleDescPrefix")}${entry.description}`,
        lines,
        loan_settlement_journal_entry_ids: [entry.id],
      });
      await refresh();
    } finally {
      closeWriteOffModal();
    }
  }

  if (loading) return null;
  if (error) {
    return <AppDataErrorAlert error={error} />;
  }

  return (
    <Stack gap="lg">
      {/* Page header */}
      <Group gap="sm">
        <Anchor component={Link} to="/fs" c="dimmed" size="sm">
          <Group gap={4}>
            <IconArrowLeft size={14} />
            {t("navFS")}
          </Group>
        </Anchor>
      </Group>

      <Group gap="sm">
        <ThemeIcon size={40} radius="md" color="violet" variant="light">
          <IconCoin size={22} />
        </ThemeIcon>
        <Box>
          <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
            {t("tabLoanMgmt")}
          </Text>
          <Text size="sm" c="dimmed">
            {t("tabLoanMgmtDesc")}
          </Text>
        </Box>
      </Group>

      {sectionData.map(({ sec, accounts: sAccounts, entriesByAccount }) => {
        const totalBalance = sAccounts.reduce(
          (s, a) => s + (a.balance ?? 0),
          0,
        );
        const activeAccounts = sAccounts.filter((a) =>
          sec.isLongTerm
            ? !a.is_completed
            : isShortTermLoanAccountActive(a, entriesByAccount.get(a.id) ?? []),
        );
        const completedAccounts = sAccounts.filter((a) =>
          sec.isLongTerm
            ? a.is_completed
            : !isShortTermLoanAccountActive(
                a,
                entriesByAccount.get(a.id) ?? [],
              ),
        );

        return (
          <Paper key={sec.titleKey} withBorder radius="md" p="lg">
            {/* Section header */}
            <Group justify="space-between" mb="md">
              <Group gap="sm">
                <ThemeIcon
                  size={32}
                  radius="md"
                  color={sec.color}
                  variant="light"
                >
                  {sec.isAsset ? (
                    <IconArrowNarrowUp size={18} />
                  ) : (
                    <IconArrowNarrowDown size={18} />
                  )}
                </ThemeIcon>
                <Text fw={700} size="md">
                  {t(sec.titleKey)}
                </Text>
              </Group>
              {totalBalance > 0 && (
                <Text fw={700} c={sec.color} size="lg">
                  {formatJPY(totalBalance, locale)}
                </Text>
              )}
            </Group>

            {sAccounts.length === 0 ? (
              <Text size="sm" c="dimmed">
                {t("noLoanAccounts")}
              </Text>
            ) : (
              <Stack gap="md">
                {/* ── Long-term: per-account card + buttons ── */}
                {sec.isLongTerm && (
                  <>
                    {activeAccounts.map((acct) => (
                      <LongTermAccountCard
                        key={acct.id}
                        acct={acct}
                        color={sec.color}
                        locale={locale}
                        kind={sec.isAsset ? "lend" : "loan"}
                        t={t}
                      />
                    ))}

                    {completedAccounts.length > 0 && (
                      <Accordion variant="separated" radius="md">
                        <Accordion.Item value="completed">
                          <Accordion.Control>
                            <Group gap="xs">
                              <IconCheck
                                size={14}
                                color="var(--mantine-color-dimmed)"
                              />
                              <Text size="sm" c="dimmed">
                                {t("loanCompletedAccordion").replace(
                                  "{count}",
                                  String(completedAccounts.length),
                                )}
                              </Text>
                            </Group>
                          </Accordion.Control>
                          <Accordion.Panel>
                            <Stack gap="sm">
                              {completedAccounts.map((acct) => (
                                <LongTermAccountCard
                                  key={acct.id}
                                  acct={acct}
                                  color={sec.color}
                                  locale={locale}
                                  kind={sec.isAsset ? "lend" : "loan"}
                                  t={t}
                                />
                              ))}
                            </Stack>
                          </Accordion.Panel>
                        </Accordion.Item>
                      </Accordion>
                    )}
                  </>
                )}

                {/* ── Short-term: per-account block with entries ── */}
                {!sec.isLongTerm && (
                  <>
                    {activeAccounts.map((acct) => (
                      <ShortTermAccountBlock
                        key={acct.id}
                        acct={acct}
                        entries={entriesByAccount.get(acct.id) ?? []}
                        color={sec.color}
                        locale={locale}
                        onInputEntry={(entry, netChange) =>
                          handleInputEntry(entry, acct, netChange)
                        }
                        onForceSettleEntry={(entry, netChange) =>
                          handleForceSettleEntry(entry, acct, netChange)
                        }
                      />
                    ))}

                    {completedAccounts.length > 0 && (
                      <Accordion variant="separated" radius="md">
                        <Accordion.Item value="completed">
                          <Accordion.Control>
                            <Group gap="xs">
                              <IconCheck
                                size={14}
                                color="var(--mantine-color-dimmed)"
                              />
                              <Text size="sm" c="dimmed">
                                {t("loanCompletedAccordion").replace(
                                  "{count}",
                                  String(completedAccounts.length),
                                )}
                              </Text>
                            </Group>
                          </Accordion.Control>
                          <Accordion.Panel>
                            <Stack gap="md">
                              {completedAccounts.map((acct) => (
                                <ShortTermAccountBlock
                                  key={acct.id}
                                  acct={acct}
                                  entries={entriesByAccount.get(acct.id) ?? []}
                                  color={sec.color}
                                  locale={locale}
                                  onInputEntry={(entry, netChange) =>
                                    handleInputEntry(entry, acct, netChange)
                                  }
                                  onForceSettleEntry={(entry, netChange) =>
                                    handleForceSettleEntry(
                                      entry,
                                      acct,
                                      netChange,
                                    )
                                  }
                                />
                              ))}
                            </Stack>
                          </Accordion.Panel>
                        </Accordion.Item>
                      </Accordion>
                    )}
                  </>
                )}
              </Stack>
            )}
          </Paper>
        );
      })}

      <Modal
        opened={pendingSettle !== null}
        onClose={closeWriteOffModal}
        title={t("loanWriteOffModalTitle")}
        size="sm"
      >
        {pendingSettle && (
          <Stack gap="md">
            <Text size="sm">
              {t("loanWriteOffDesc").replace(
                "{desc}",
                pendingSettle.entry.description,
              )}
            </Text>
            <Group gap="xs">
              <Text size="sm" c="dimmed">
                {t("loanWriteOffAmountLabel")}:
              </Text>
              <Text size="sm" fw={700}>
                {formatJPY(pendingSettle.netChange, locale)}
              </Text>
            </Group>
            <Select
              label={
                pendingSettle.acct.type === "asset"
                  ? t("loanWriteOffExpenseLabel")
                  : t("loanWriteOffIncomeLabel")
              }
              placeholder={
                pendingSettle.acct.type === "asset"
                  ? t("loanWriteOffExpenseLabel")
                  : t("loanWriteOffIncomeLabel")
              }
              data={
                pendingSettle.acct.type === "asset"
                  ? counterAccountOptions.expense
                  : counterAccountOptions.income
              }
              renderOption={renderAccountOption as never}
              value={
                settleCounterAccountId !== null
                  ? String(settleCounterAccountId)
                  : null
              }
              onChange={(v) =>
                setSettleCounterAccountId(v !== null ? Number(v) : null)
              }
              searchable
            />
            <Group justify="flex-end" gap="xs">
              <Button variant="subtle" onClick={closeWriteOffModal}>
                {t("cancel")}
              </Button>
              <Button
                color="orange"
                disabled={settleCounterAccountId === null}
                onClick={() => void handleConfirmSettle()}
              >
                {t("loanWriteOffConfirmBtn")}
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </Stack>
  );
}

// ── Long-term account card ──────────────────────────────────────────────────

interface LongTermAccountCardProps {
  acct: ReturnType<
    typeof import("../context/AppDataContext").useAppData
  >["accounts"][number];
  color: string;
  locale: string;
  kind: "loan" | "lend";
  t: ReturnType<typeof import("../i18n").useLang>["t"];
}

function LongTermAccountCard({
  acct,
  color,
  locale,
  kind,
  t,
}: LongTermAccountCardProps) {
  return (
    <Card
      withBorder
      radius="md"
      p="sm"
      opacity={acct.is_completed ? 0.7 : 1}
      style={
        acct.is_completed
          ? undefined
          : { borderLeft: `3px solid var(--mantine-color-${color}-6)` }
      }
    >
      <Group justify="space-between" align="flex-start" wrap="wrap" gap="sm">
        <Group gap="sm" style={{ flex: 1, minWidth: 0 }}>
          <ThemeIcon
            size={28}
            radius="sm"
            color={acct.is_completed ? "gray" : color}
            variant="light"
          >
            <IconBuildingBank size={14} />
          </ThemeIcon>
          <Box style={{ minWidth: 0 }}>
            <Group gap={6}>
              <Text
                size="sm"
                fw={600}
                c={acct.is_completed ? "dimmed" : undefined}
              >
                {acct.name}
              </Text>
              {acct.is_completed && (
                <Badge size="xs" color="gray" variant="light">
                  {t("loanCompletedBadge")}
                </Badge>
              )}
            </Group>
            <Text size="xs" c="dimmed">
              {acct.created_at.slice(0, 10)}
            </Text>
          </Box>
        </Group>
        <Group gap="xs" align="center">
          <Box ta="right">
            <Text size="xs" c="dimmed" tt="uppercase" fw={700} mb={2}>
              {t("loanAccountBalance")}
            </Text>
            <Text
              size="lg"
              fw={800}
              c={(acct.balance ?? 0) > 0 ? color : "dimmed"}
            >
              {formatJPY(acct.balance ?? 0, locale)}
            </Text>
          </Box>
        </Group>
      </Group>
      <Group gap="xs" mt="sm">
        <Button
          component={Link}
          to={`/fs/db/long-term-${kind}/${acct.id}`}
          size="xs"
          variant="filled"
          color={color}
          leftSection={<IconCalendarStats size={12} />}
        >
          {t("loanDetailBtn")}
        </Button>
      </Group>
    </Card>
  );
}

// ── Short-term account block (header + entries) ─────────────────────────────

interface EntryWithChange {
  entry: ReturnType<
    typeof import("../context/AppDataContext").useAppData
  >["journal"][number];
  netChange: number;
}

interface ShortTermAccountBlockProps {
  acct: ReturnType<
    typeof import("../context/AppDataContext").useAppData
  >["accounts"][number];
  entries: EntryWithChange[];
  color: string;
  locale: string;
  onInputEntry: (entry: JournalEntry, netChange: number) => void;
  onForceSettleEntry: (entry: JournalEntry, netChange: number) => void;
}

function ShortTermAccountBlock({
  acct,
  entries,
  color,
  locale,
  onInputEntry,
  onForceSettleEntry,
}: ShortTermAccountBlockProps) {
  const { t } = useLang();

  const { activeEntries, settledPairs } = useMemo(() => {
    const settledOpeningIds = new Set<number>();
    const settlementEntryIds = new Set<number>();

    for (const { entry, netChange } of entries) {
      if (netChange > 0 && entry.loan_settlement?.is_settled === true) {
        settledOpeningIds.add(entry.id);
        if (entry.loan_settlement.settled_by_journal_entry_id != null) {
          settlementEntryIds.add(
            entry.loan_settlement.settled_by_journal_entry_id,
          );
        }
      }
    }

    const entryMap = new Map(entries.map((e) => [e.entry.id, e]));

    const pairs = [...settledOpeningIds].map((openingId) => {
      const opening = entryMap.get(openingId)!;
      const settlementId =
        opening.entry.loan_settlement?.settled_by_journal_entry_id;
      const settlement =
        settlementId != null ? entryMap.get(settlementId) : undefined;
      return { opening, settlement };
    });

    const active = entries.filter(
      ({ entry }) =>
        !settledOpeningIds.has(entry.id) && !settlementEntryIds.has(entry.id),
    );

    return { activeEntries: active, settledPairs: pairs };
  }, [entries]);

  return (
    <Stack gap="xs">
      {/* Account summary header */}
      <Card
        withBorder
        radius="md"
        p="sm"
        bg={
          acct.is_completed ? undefined : `var(--mantine-color-${color}-light)`
        }
        opacity={acct.is_completed ? 0.75 : 1}
      >
        <Group justify="space-between" wrap="wrap" gap="sm">
          <Group gap="sm">
            <ThemeIcon
              size={28}
              radius="sm"
              color={acct.is_completed ? "gray" : color}
              variant={acct.is_completed ? "light" : "filled"}
            >
              <IconBuildingBank size={14} />
            </ThemeIcon>
            <Box>
              <Group gap={6}>
                <Text
                  size="sm"
                  fw={700}
                  c={acct.is_completed ? "dimmed" : undefined}
                >
                  {acct.name}
                </Text>
                {acct.is_completed && (
                  <Badge size="xs" color="gray" variant="light">
                    {t("loanCompletedBadge")}
                  </Badge>
                )}
              </Group>
              <Text size="xs" c="dimmed">
                {acct.created_at.slice(0, 10)}
              </Text>
            </Box>
          </Group>
          <Box ta="right">
            <Text size="xs" c="dimmed" fw={600}>
              {t("loanAccountBalance")}
            </Text>
            <Text
              size="lg"
              fw={800}
              c={
                acct.is_completed
                  ? "dimmed"
                  : (acct.balance ?? 0) > 0
                    ? color
                    : "dimmed"
              }
            >
              {formatJPY(acct.balance ?? 0, locale)}
            </Text>
          </Box>
        </Group>
      </Card>

      {/* Active (unsettled) entries */}
      {activeEntries.length === 0 && settledPairs.length === 0 ? (
        <Text size="xs" c="dimmed" ta="center" py="xs">
          {t("loanNoEntries")}
        </Text>
      ) : (
        activeEntries.map(({ entry, netChange }) => {
          const isIncrease = netChange > 0;
          return (
            <Card
              key={entry.id}
              withBorder
              radius="md"
              p="sm"
              ml="md"
              style={{
                borderLeft: `3px solid var(--mantine-color-${isIncrease ? color : "gray"}-6)`,
              }}
            >
              <Group justify="space-between" align="flex-start">
                <Box style={{ flex: 1, minWidth: 0 }}>
                  <Text size="sm" fw={600} lineClamp={1}>
                    {entry.description}
                  </Text>
                  <Group gap={6} mt={2}>
                    <Text size="xs" c="dimmed">
                      {entry.date}
                    </Text>
                    <Badge
                      size="xs"
                      color={isIncrease ? color : "gray"}
                      variant="light"
                    >
                      {isIncrease
                        ? t("loanOpeningEntry")
                        : t("loanSettlementEntry")}
                    </Badge>
                  </Group>
                </Box>
                <Text
                  size="sm"
                  fw={700}
                  c={isIncrease ? color : "dimmed"}
                  style={{ whiteSpace: "nowrap" }}
                >
                  {isIncrease ? "+" : ""}
                  {formatJPY(netChange, locale)}
                </Text>
              </Group>
              {isIncrease && !acct.is_completed && (
                <Group gap="xs" mt="sm">
                  <Button
                    size="xs"
                    variant="light"
                    color={color}
                    leftSection={<IconPencil size={12} />}
                    onClick={() => onInputEntry(entry, netChange)}
                  >
                    {t("loanInputBtn")}
                  </Button>
                  <Button
                    size="xs"
                    variant="subtle"
                    color="orange"
                    leftSection={<IconCheck size={12} />}
                    onClick={() => onForceSettleEntry(entry, netChange)}
                  >
                    {t("loanForceCompleteBtn")}
                  </Button>
                </Group>
              )}
            </Card>
          );
        })
      )}

      {/* Settled pairs — collapsed into accordion */}
      {settledPairs.length > 0 && (
        <Accordion variant="separated" radius="md" ml="md">
          <Accordion.Item value="settled">
            <Accordion.Control>
              <Group gap="xs">
                <IconCheck size={14} color="var(--mantine-color-dimmed)" />
                <Text size="sm" c="dimmed">
                  {t("loanSettledPairsAccordion").replace(
                    "{count}",
                    String(settledPairs.length),
                  )}
                </Text>
              </Group>
            </Accordion.Control>
            <Accordion.Panel>
              <Stack gap="sm">
                {settledPairs.map(({ opening, settlement }) => (
                  <SettledPairCard
                    key={opening.entry.id}
                    opening={opening}
                    settlement={settlement}
                    locale={locale}
                    t={t}
                  />
                ))}
              </Stack>
            </Accordion.Panel>
          </Accordion.Item>
        </Accordion>
      )}

      <Divider />
    </Stack>
  );
}

// ── Settled pair card (opening + settlement shown as a linked set) ───────────

interface SettledPairCardProps {
  opening: EntryWithChange;
  settlement: EntryWithChange | undefined;
  locale: string;
  t: ReturnType<typeof useLang>["t"];
}

function SettledPairCard({
  opening,
  settlement,
  locale,
  t,
}: SettledPairCardProps) {
  return (
    <Card
      withBorder
      radius="md"
      p="sm"
      opacity={0.8}
      style={{ borderLeft: "3px solid var(--mantine-color-gray-5)" }}
    >
      {/* Opening entry row */}
      <Group justify="space-between" align="flex-start" wrap="nowrap">
        <Box style={{ flex: 1, minWidth: 0 }}>
          <Text size="sm" fw={600} c="dimmed" lineClamp={1}>
            {opening.entry.description}
          </Text>
          <Group gap={6} mt={2}>
            <Text size="xs" c="dimmed">
              {opening.entry.date}
            </Text>
            <Badge size="xs" color="gray" variant="dot">
              {t("loanSettledOpeningLabel")}
            </Badge>
          </Group>
        </Box>
        <Text size="sm" fw={700} c="dimmed" style={{ whiteSpace: "nowrap" }}>
          +{formatJPY(opening.netChange, locale)}
        </Text>
      </Group>

      {settlement && (
        <>
          <Divider
            my={6}
            label={
              <Text size="xs" c="dimmed">
                ↓
              </Text>
            }
            labelPosition="left"
          />
          {/* Settlement entry row */}
          <Group justify="space-between" align="flex-start" wrap="nowrap">
            <Box style={{ flex: 1, minWidth: 0 }}>
              <Text size="sm" fw={600} c="dimmed" lineClamp={1}>
                {settlement.entry.description}
              </Text>
              <Group gap={6} mt={2}>
                <Text size="xs" c="dimmed">
                  {settlement.entry.date}
                </Text>
                <Badge size="xs" color="green" variant="dot">
                  {t("loanSettledByLabel")}
                </Badge>
              </Group>
            </Box>
            <Text
              size="sm"
              fw={700}
              c="dimmed"
              style={{ whiteSpace: "nowrap" }}
            >
              {formatJPY(settlement.netChange, locale)}
            </Text>
          </Group>
        </>
      )}
    </Card>
  );
}
