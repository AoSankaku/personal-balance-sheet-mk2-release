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
  Switch,
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
import { formatCurrency } from "../lib/numberFormat";
import { toDateStr } from "../lib/dateUtils";
import { isShortTermLoanAccountActive } from "./dbPageUtils";
import {
  buildAccountOptionsByCategory,
  renderAccountOption,
} from "../lib/accountSelect";
import { AppDataErrorAlert } from "../components/AppDataErrorAlert";
import { isUserSelectableAccount } from "../lib/accountUtils";

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

function normalizeCurrency(currency: string | null | undefined) {
  return (currency || "JPY").toUpperCase();
}

function accountBalanceInCurrency(
  account: ReturnType<typeof useAppData>["accounts"][number],
  currency: string,
) {
  if (account.balances) return account.balances[currency] ?? 0;
  return currency === "JPY" ? (account.balance ?? 0) : 0;
}

export default function DbPage() {
  const { t, locale } = useLang();
  const {
    accounts,
    journal,
    loading,
    error,
    refresh,
    displayCurrency,
    displayCurrencySymbol,
  } = useAppData();
  const navigate = useNavigate();
  const selectedCurrency = normalizeCurrency(displayCurrency);
  const [showAllCurrencies, setShowAllCurrencies] = useState(false);
  const [pendingSettle, setPendingSettle] = useState<{
    entry: JournalEntry;
    acct: ReturnType<typeof useAppData>["accounts"][number];
    netChange: number;
    currency: string;
  } | null>(null);
  const [settleCounterAccountId, setSettleCounterAccountId] = useState<
    number | null
  >(null);

  const sectionData = useMemo(() => {
    return SECTIONS.map((sec) => {
      const sectionAccounts = accounts
        .filter((a) => sec.categoryFilter(a.category))
        .sort(
          (a, b) =>
            new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
        );

      const accountViews = sectionAccounts.flatMap((acct) => {
        const entriesByCurrency = new Map<string, EntryWithChange[]>();

        for (const entry of journal) {
          const amountByCurrency = new Map<string, number>();
          for (const line of entry.lines) {
            if (line.account_id !== acct.id) continue;
            const currency = normalizeCurrency(line.currency);
            const change =
              acct.type === "asset" || acct.type === "expense"
                ? line.debit - line.credit
                : line.credit - line.debit;
            amountByCurrency.set(
              currency,
              (amountByCurrency.get(currency) ?? 0) + change,
            );
          }
          for (const [currency, netChange] of amountByCurrency) {
            if (Math.abs(netChange) <= 0.001) continue;
            if (!entriesByCurrency.has(currency)) {
              entriesByCurrency.set(currency, []);
            }
            entriesByCurrency.get(currency)!.push({
              entry,
              netChange,
              currency,
            });
          }
        }

        for (const entries of entriesByCurrency.values()) {
          entries.sort(
            (a, b) =>
              new Date(b.entry.date).getTime() -
                new Date(a.entry.date).getTime() || b.entry.id - a.entry.id,
          );
        }

        const currencies = new Set<string>();
        if (showAllCurrencies) {
          for (const [currency, balance] of Object.entries(
            acct.balances ?? {},
          )) {
            if (Math.abs(balance) > 0.001) currencies.add(currency);
          }
          for (const currency of entriesByCurrency.keys()) {
            currencies.add(currency);
          }
        } else {
          const selectedBalance = accountBalanceInCurrency(
            acct,
            selectedCurrency,
          );
          const selectedEntries = entriesByCurrency.get(selectedCurrency) ?? [];
          if (
            Math.abs(selectedBalance) > 0.001 ||
            selectedEntries.length > 0
          ) {
            currencies.add(selectedCurrency);
          }
        }

        return [...currencies]
          .sort((a, b) =>
            a === selectedCurrency
              ? -1
              : b === selectedCurrency
                ? 1
                : a.localeCompare(b),
          )
          .map((currency) => ({
            acct,
            currency,
            balance: accountBalanceInCurrency(acct, currency),
            entries: entriesByCurrency.get(currency) ?? [],
          }));
      });

      return { sec, accountViews };
    });
  }, [accounts, journal, selectedCurrency, showAllCurrencies]);

  const counterAccountOptions = useMemo(() => {
    const buildGrouped = (type: "expense" | "income") =>
      buildAccountOptionsByCategory(
        accounts.filter((a) => a.type === type && isUserSelectableAccount(a)),
        t,
      );
    return { expense: buildGrouped("expense"), income: buildGrouped("income") };
  }, [accounts, t]);

  function handleInputEntry(
    entry: JournalEntry,
    acct: ReturnType<typeof useAppData>["accounts"][number],
    netChange: number,
    currency: string,
  ) {
    if (currency !== selectedCurrency) return;
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
    currency: string,
  ) {
    if (currency !== selectedCurrency) return;
    setPendingSettle({ entry, acct, netChange, currency });
    setSettleCounterAccountId(null);
  }

  function closeWriteOffModal() {
    setPendingSettle(null);
    setSettleCounterAccountId(null);
  }

  async function handleConfirmSettle() {
    if (!pendingSettle || settleCounterAccountId === null) return;
    try {
      const { entry, acct, currency } = pendingSettle;
      const today = toDateStr(new Date());

      let amount = 0;
      for (const l of entry.lines) {
        if (l.account_id !== acct.id) continue;
        if (normalizeCurrency(l.currency) !== currency) continue;
        const change =
          acct.type === "asset" || acct.type === "expense"
            ? l.debit - l.credit
            : l.credit - l.debit;
        amount += change;
      }
      if (amount <= 0) return;

      const lines: {
        account_id: number;
        debit: number;
        credit: number;
        currency: string;
      }[] = [];
      if (acct.type === "asset" || acct.type === "expense") {
        lines.push(
          {
            account_id: settleCounterAccountId,
            debit: amount,
            credit: 0,
            currency,
          },
          {
            account_id: acct.id,
            debit: 0,
            credit: amount,
            currency,
          },
        );
      } else {
        lines.push(
          {
            account_id: acct.id,
            debit: amount,
            credit: 0,
            currency,
          },
          {
            account_id: settleCounterAccountId,
            debit: 0,
            credit: amount,
            currency,
          },
        );
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
      <Group justify="flex-end">
        <Switch
          label={t("includeAllCurrencies")}
          checked={showAllCurrencies}
          onChange={(event) =>
            setShowAllCurrencies(event.currentTarget.checked)
          }
        />
      </Group>

      {sectionData.map(({ sec, accountViews }) => {
        const totalBalance = accountViews
          .filter((view) => view.currency === selectedCurrency)
          .reduce((sum, view) => sum + view.balance, 0);
        const activeAccounts = accountViews.filter((view) =>
          sec.isLongTerm
            ? !view.acct.is_completed && Math.abs(view.balance) > 0.001
            : isShortTermLoanAccountActive(
                { is_completed: view.acct.is_completed, balance: view.balance },
                view.entries,
              ),
        );
        const completedAccounts = accountViews.filter(
          (view) => !activeAccounts.includes(view),
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
                  {formatCurrency(
                    totalBalance,
                    locale,
                    selectedCurrency,
                    displayCurrencySymbol,
                  )}
                </Text>
              )}
            </Group>

            {accountViews.length === 0 ? (
              <Text size="sm" c="dimmed">
                {t("noLoanAccounts")}
              </Text>
            ) : (
              <Stack gap="md">
                {/* ── Long-term: per-account card + buttons ── */}
                {sec.isLongTerm && (
                  <>
                    {activeAccounts.map((view) => (
                      <LongTermAccountCard
                        key={`${view.acct.id}:${view.currency}`}
                        acct={view.acct}
                        balance={view.balance}
                        currency={view.currency}
                        selectedCurrency={selectedCurrency}
                        displayCurrencySymbol={displayCurrencySymbol}
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
                              {completedAccounts.map((view) => (
                                <LongTermAccountCard
                                  key={`${view.acct.id}:${view.currency}`}
                                  acct={view.acct}
                                  balance={view.balance}
                                  currency={view.currency}
                                  selectedCurrency={selectedCurrency}
                                  displayCurrencySymbol={displayCurrencySymbol}
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
                    {activeAccounts.map((view) => (
                      <ShortTermAccountBlock
                        key={`${view.acct.id}:${view.currency}`}
                        acct={view.acct}
                        balance={view.balance}
                        currency={view.currency}
                        selectedCurrency={selectedCurrency}
                        displayCurrencySymbol={displayCurrencySymbol}
                        entries={view.entries}
                        color={sec.color}
                        locale={locale}
                        onInputEntry={(entry, netChange) =>
                          handleInputEntry(
                            entry,
                            view.acct,
                            netChange,
                            view.currency,
                          )
                        }
                        onForceSettleEntry={(entry, netChange) =>
                          handleForceSettleEntry(
                            entry,
                            view.acct,
                            netChange,
                            view.currency,
                          )
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
                              {completedAccounts.map((view) => (
                                <ShortTermAccountBlock
                                  key={`${view.acct.id}:${view.currency}`}
                                  acct={view.acct}
                                  balance={view.balance}
                                  currency={view.currency}
                                  selectedCurrency={selectedCurrency}
                                  displayCurrencySymbol={displayCurrencySymbol}
                                  entries={view.entries}
                                  color={sec.color}
                                  locale={locale}
                                  onInputEntry={(entry, netChange) =>
                                    handleInputEntry(
                                      entry,
                                      view.acct,
                                      netChange,
                                      view.currency,
                                    )
                                  }
                                  onForceSettleEntry={(entry, netChange) =>
                                    handleForceSettleEntry(
                                      entry,
                                      view.acct,
                                      netChange,
                                      view.currency,
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
                {formatCurrency(
                  pendingSettle.netChange,
                  locale,
                  pendingSettle.currency,
                  pendingSettle.currency === selectedCurrency
                    ? displayCurrencySymbol
                    : undefined,
                )}
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
  balance: number;
  currency: string;
  selectedCurrency: string;
  displayCurrencySymbol: string;
  color: string;
  locale: string;
  kind: "loan" | "lend";
  t: ReturnType<typeof import("../i18n").useLang>["t"];
}

function LongTermAccountCard({
  acct,
  balance,
  currency,
  selectedCurrency,
  displayCurrencySymbol,
  color,
  locale,
  kind,
  t,
}: LongTermAccountCardProps) {
  const isSelectedCurrency = currency === selectedCurrency;
  const isCompleted = acct.is_completed || Math.abs(balance) <= 0.001;

  return (
    <Card
      withBorder
      radius="md"
      p="sm"
      opacity={isCompleted ? 0.7 : 1}
      style={
        isCompleted
          ? undefined
          : { borderLeft: `3px solid var(--mantine-color-${color}-6)` }
      }
    >
      <Group justify="space-between" align="flex-start" wrap="wrap" gap="sm">
        <Group gap="sm" style={{ flex: 1, minWidth: 0 }}>
          <ThemeIcon
            size={28}
            radius="sm"
            color={isCompleted ? "gray" : color}
            variant="light"
          >
            <IconBuildingBank size={14} />
          </ThemeIcon>
          <Box style={{ minWidth: 0 }}>
            <Group gap={6}>
              <Text
                size="sm"
                fw={600}
                c={isCompleted ? "dimmed" : undefined}
              >
                {acct.name}
              </Text>
              <Badge size="xs" variant="light">
                {currency}
              </Badge>
              {isCompleted && (
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
              c={balance > 0 ? color : "dimmed"}
            >
              {formatCurrency(
                balance,
                locale,
                currency,
                isSelectedCurrency ? displayCurrencySymbol : undefined,
              )}
            </Text>
          </Box>
        </Group>
      </Group>
      <Group gap="xs" mt="sm">
        {isSelectedCurrency ? (
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
        ) : (
          <Button
            size="xs"
            variant="filled"
            color={color}
            disabled
            title={t("loanOtherCurrencyReadOnly")}
            leftSection={<IconCalendarStats size={12} />}
          >
            {t("loanDetailBtn")}
          </Button>
        )}
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
  currency: string;
}

interface ShortTermAccountBlockProps {
  acct: ReturnType<
    typeof import("../context/AppDataContext").useAppData
  >["accounts"][number];
  balance: number;
  currency: string;
  selectedCurrency: string;
  displayCurrencySymbol: string;
  entries: EntryWithChange[];
  color: string;
  locale: string;
  onInputEntry: (entry: JournalEntry, netChange: number) => void;
  onForceSettleEntry: (entry: JournalEntry, netChange: number) => void;
}

function ShortTermAccountBlock({
  acct,
  balance,
  currency,
  selectedCurrency,
  displayCurrencySymbol,
  entries,
  color,
  locale,
  onInputEntry,
  onForceSettleEntry,
}: ShortTermAccountBlockProps) {
  const { t } = useLang();
  const isSelectedCurrency = currency === selectedCurrency;

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
                <Badge size="xs" variant="light">
                  {currency}
                </Badge>
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
                  : balance > 0
                    ? color
                    : "dimmed"
              }
            >
              {formatCurrency(
                balance,
                locale,
                currency,
                isSelectedCurrency ? displayCurrencySymbol : undefined,
              )}
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
        activeEntries.map(({ entry, netChange, currency: entryCurrency }) => {
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
                    <Badge size="xs" variant="light">
                      {entryCurrency}
                    </Badge>
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
                  {formatCurrency(
                    netChange,
                    locale,
                    entryCurrency,
                    entryCurrency === selectedCurrency
                      ? displayCurrencySymbol
                      : undefined,
                  )}
                </Text>
              </Group>
              {isIncrease && !acct.is_completed && (
                <Group gap="xs" mt="sm">
                  <Button
                    size="xs"
                    variant="light"
                    color={color}
                    disabled={!isSelectedCurrency}
                    title={
                      !isSelectedCurrency
                        ? t("loanOtherCurrencyReadOnly")
                        : undefined
                    }
                    leftSection={<IconPencil size={12} />}
                    onClick={() => onInputEntry(entry, netChange)}
                  >
                    {t("loanInputBtn")}
                  </Button>
                  <Button
                    size="xs"
                    variant="subtle"
                    color="orange"
                    disabled={!isSelectedCurrency}
                    title={
                      !isSelectedCurrency
                        ? t("loanOtherCurrencyReadOnly")
                        : undefined
                    }
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
                    selectedCurrency={selectedCurrency}
                    displayCurrencySymbol={displayCurrencySymbol}
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
  selectedCurrency: string;
  displayCurrencySymbol: string;
  t: ReturnType<typeof useLang>["t"];
}

function SettledPairCard({
  opening,
  settlement,
  locale,
  selectedCurrency,
  displayCurrencySymbol,
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
            <Badge size="xs" variant="light">
              {opening.currency}
            </Badge>
            <Badge size="xs" color="gray" variant="dot">
              {t("loanSettledOpeningLabel")}
            </Badge>
          </Group>
        </Box>
        <Text size="sm" fw={700} c="dimmed" style={{ whiteSpace: "nowrap" }}>
          +
          {formatCurrency(
            opening.netChange,
            locale,
            opening.currency,
            opening.currency === selectedCurrency
              ? displayCurrencySymbol
              : undefined,
          )}
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
                <Badge size="xs" variant="light">
                  {settlement.currency}
                </Badge>
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
              {formatCurrency(
                settlement.netChange,
                locale,
                settlement.currency,
                settlement.currency === selectedCurrency
                  ? displayCurrencySymbol
                  : undefined,
              )}
            </Text>
          </Group>
        </>
      )}
    </Card>
  );
}
