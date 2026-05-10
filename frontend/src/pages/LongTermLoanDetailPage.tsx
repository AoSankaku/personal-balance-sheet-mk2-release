import {
  ActionIcon,
  Anchor,
  Badge,
  Box,
  Button,
  Card,
  Divider,
  Group,
  Modal,
  NumberInput,
  Paper,
  ScrollArea,
  SegmentedControl,
  Select,
  Skeleton,
  Stack,
  Table,
  Text,
  TextInput,
  ThemeIcon,
  Tooltip,
} from "@mantine/core";
import { MonthPickerInput } from "@mantine/dates";
import {
  IconArrowLeft,
  IconBuildingBank,
  IconCheck,
  IconDeviceFloppy,
  IconMathFunction,
  IconPencil,
  IconPlus,
  IconRefresh,
  IconTrash,
} from "@tabler/icons-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import type {
  LongTermLoanPlan,
  UpsertLongTermLoanPlanRowInput,
} from "@balance-sheet/shared";
import {
  isLongTermBorrowingCategory,
  isLongTermLendingCategory,
} from "@balance-sheet/shared";
import { useLang } from "../i18n";
import { useAppData } from "../context/AppDataContext";
import { api } from "../api/client";
import { formatJPY } from "../lib/numberFormat";
import {
  addMonths,
  calcExpectedInterest,
  calcMonthlyPayment,
  classifyEntries,
  currentYearMonth,
  estimateMonths,
  formatYearMonth,
  generatePlanRows,
  impliedAnnualRate,
  type ClassifiedEntry,
} from "./longTermLoanUtils";

interface Props {
  kind: "loan" | "lend";
}

interface EditableRow {
  year_month: string;
  principal_amount: number | string;
  interest_amount: number | string;
  note: string;
}

interface InterestModalState {
  classified: ClassifiedEntry;
  date: string;
  description: string;
  amount: number | string;
  interestAccountId: string | null;
  paymentAccountId: string | null;
}

export default function LongTermLoanDetailPage({ kind }: Props) {
  const { t, locale } = useLang();
  const { id } = useParams<{ id: string }>();
  const { accounts, journal, refresh } = useAppData();
  const navigate = useNavigate();
  const accountId = Number(id);
  const isAsset = kind === "lend";

  const account = accounts.find((a) => a.id === accountId);

  const isCorrectKind = account
    ? isAsset
      ? isLongTermLendingCategory(account.category as never)
      : isLongTermBorrowingCategory(account.category as never)
    : true;

  // ── Force complete ──────────────────────────────────────────────────────────
  const [completing, setCompleting] = useState(false);

  async function handleForceComplete() {
    setCompleting(true);
    try {
      await api.accounts.forceComplete(accountId);
      await refresh();
    } finally {
      setCompleting(false);
    }
  }

  async function handleForceUncomplete() {
    setCompleting(true);
    try {
      await api.accounts.forceUncomplete(accountId);
      await refresh();
    } finally {
      setCompleting(false);
    }
  }

  function handleGoToInput() {
    navigate("/input", {
      state: {
        loanDraft: {
          entryType: "loan",
          loanDirection: isAsset ? "collect" : "decrease",
          loanAccountId: accountId,
        },
        tab: "simple",
      },
    });
  }

  // ── Plan state ──────────────────────────────────────────────────────────────
  const [plan, setPlan] = useState<LongTermLoanPlan | null>(null);
  const [planLoading, setPlanLoading] = useState(true);
  const [totalPrincipal, setTotalPrincipal] = useState<number | string>("");
  const [annualRate, setAnnualRate] = useState<number | string>("");
  const [startMonth, setStartMonth] = useState("");
  const [planNote, setPlanNote] = useState("");
  const [headerSaving, setHeaderSaving] = useState(false);
  const [headerSaved, setHeaderSaved] = useState(false);

  const [rows, setRows] = useState<EditableRow[]>([]);
  const [rowsDirty, setRowsDirty] = useState(false);
  const [rowsSaving, setRowsSaving] = useState(false);
  const [rowsSaved, setRowsSaved] = useState(false);

  const [autoFillOpen, setAutoFillOpen] = useState(false);
  const [fillMethod, setFillMethod] = useState<
    "equal_payment" | "equal_principal"
  >("equal_payment");
  const [fillMonths, setFillMonths] = useState<number | string>("");
  const [fillMonthlyPayment, setFillMonthlyPayment] = useState<number | string>(
    "",
  );

  // ── Interest entry modal ────────────────────────────────────────────────────
  const [interestModal, setInterestModal] = useState<InterestModalState | null>(
    null,
  );
  const [interestSaving, setInterestSaving] = useState(false);

  // ── Load plan ───────────────────────────────────────────────────────────────
  const loadPlan = useCallback(async () => {
    setPlanLoading(true);
    try {
      const res = await api.longTermLoanPlans.get(accountId);
      setPlan(res.plan);
      if (res.plan) {
        setTotalPrincipal(res.plan.total_principal ?? "");
        setAnnualRate(res.plan.annual_interest_rate ?? "");
        setStartMonth(res.plan.start_year_month ?? "");
        setPlanNote(res.plan.note ?? "");
        setRows(
          res.plan.rows.map((r) => ({
            year_month: r.year_month,
            principal_amount: r.principal_amount,
            interest_amount: r.interest_amount,
            note: r.note ?? "",
          })),
        );
      }
    } finally {
      setPlanLoading(false);
    }
  }, [accountId]);

  useEffect(() => {
    void loadPlan();
  }, [loadPlan]);

  // ── Computed: classify journal entries ──────────────────────────────────────
  const accountsMap = useMemo(
    () => new Map(accounts.map((a) => [a.id, a])),
    [accounts],
  );

  const classifiedHistory = useMemo(
    () => classifyEntries(journal, accountId, isAsset, accountsMap),
    [journal, accountId, isAsset, accountsMap],
  );

  // Average implied annual rate from all fee-bearing repayment entries
  const avgImpliedRate = useMemo(() => {
    const rates = classifiedHistory
      .filter(
        (c) => c.feeAmount > 0 && c.balanceBefore > 0 && c.principalChange < 0,
      )
      .map((c) => impliedAnnualRate(c.feeAmount, c.balanceBefore))
      .filter((r): r is number => r !== null);
    if (rates.length === 0) return null;
    return rates.reduce((a, b) => a + b, 0) / rates.length;
  }, [classifiedHistory]);

  // Monthly comparison: frontend-computed from classifiedHistory + plan rows
  const monthlyComparison = useMemo(() => {
    const actualByMonth = new Map<
      string,
      {
        repayments: number;
        borrowings: number;
        fees: number;
        entryIds: number[];
      }
    >();

    for (const c of classifiedHistory) {
      const ym = c.entry.date.slice(0, 7);
      const existing = actualByMonth.get(ym) ?? {
        repayments: 0,
        borrowings: 0,
        fees: 0,
        entryIds: [],
      };
      if (c.principalChange < 0) {
        existing.repayments += -c.principalChange;
      } else {
        existing.borrowings += c.principalChange;
      }
      existing.fees += c.feeAmount;
      existing.entryIds.push(c.entry.id);
      actualByMonth.set(ym, existing);
    }

    const planRows = plan?.rows ?? [];
    const allMonths = new Set([
      ...planRows.map((r) => r.year_month),
      ...actualByMonth.keys(),
    ]);

    return [...allMonths].sort().map((ym) => {
      const planRow = planRows.find((r) => r.year_month === ym);
      const actual = actualByMonth.get(ym);
      return {
        year_month: ym,
        planned_principal: planRow?.principal_amount ?? 0,
        planned_interest: planRow?.interest_amount ?? 0,
        actual_repayment: actual?.repayments ?? 0,
        actual_borrowing: actual?.borrowings ?? 0,
        actual_fee: actual?.fees ?? 0,
        diff_principal:
          (actual?.repayments ?? 0) - (planRow?.principal_amount ?? 0),
        entry_ids: actual?.entryIds ?? [],
      };
    });
  }, [classifiedHistory, plan]);

  // ── Plan header save ────────────────────────────────────────────────────────
  async function handleSaveHeader() {
    setHeaderSaving(true);
    try {
      const res = await api.longTermLoanPlans.upsert({
        account_id: accountId,
        total_principal: totalPrincipal !== "" ? Number(totalPrincipal) : null,
        annual_interest_rate: annualRate !== "" ? Number(annualRate) : null,
        start_year_month: startMonth || null,
        note: planNote || null,
      });
      setPlan(res.plan);
      setHeaderSaved(true);
      setTimeout(() => setHeaderSaved(false), 2000);
    } finally {
      setHeaderSaving(false);
    }
  }

  // ── Plan rows save ──────────────────────────────────────────────────────────
  async function handleSaveRows() {
    let currentPlan = plan;
    if (!currentPlan) {
      const res = await api.longTermLoanPlans.upsert({ account_id: accountId });
      setPlan(res.plan);
      currentPlan = res.plan;
    }

    setRowsSaving(true);
    try {
      const validRows: UpsertLongTermLoanPlanRowInput[] = rows
        .filter((r) => r.year_month)
        .map((r) => ({
          year_month: r.year_month,
          principal_amount: Number(r.principal_amount) || 0,
          interest_amount: Number(r.interest_amount) || 0,
          note: r.note || null,
        }));
      const res = await api.longTermLoanPlans.upsertRows(accountId, validRows);
      // Update plan rows in state without re-fetching
      setPlan((prev) => (prev ? { ...prev, rows: res.rows } : prev));
      setRowsDirty(false);
      setRowsSaved(true);
      setTimeout(() => setRowsSaved(false), 2000);
    } finally {
      setRowsSaving(false);
    }
  }

  async function handleDeleteRow(idx: number) {
    const row = rows[idx];
    if (plan && row.year_month) {
      await api.longTermLoanPlans.deleteRow(accountId, row.year_month);
      setPlan((prev) =>
        prev
          ? {
              ...prev,
              rows: prev.rows.filter((r) => r.year_month !== row.year_month),
            }
          : prev,
      );
    }
    setRows((prev) => prev.filter((_, i) => i !== idx));
    setRowsDirty(true);
  }

  function handleAddRow() {
    const lastYm =
      rows.length > 0 ? rows[rows.length - 1].year_month : currentYearMonth();
    setRows((prev) => [
      ...prev,
      {
        year_month: addMonths(lastYm, 1),
        principal_amount: 0,
        interest_amount: 0,
        note: "",
      },
    ]);
    setRowsDirty(true);
  }

  function handleAutoFill() {
    const total = Number(totalPrincipal);
    const rate = Number(annualRate) || 0;
    const start = startMonth || currentYearMonth();
    if (!total) return;

    const generated =
      fillMethod === "equal_payment"
        ? generatePlanRows({
            totalPrincipal: total,
            annualInterestRate: rate,
            startYearMonth: start,
            method: "equal_payment",
            fixedMonthlyPayment: Number(fillMonthlyPayment),
          })
        : generatePlanRows({
            totalPrincipal: total,
            months: Number(fillMonths),
            annualInterestRate: rate,
            startYearMonth: start,
            method: "equal_principal",
          });
    setRows(
      generated.map((r) => ({
        year_month: r.year_month,
        principal_amount: r.principal_amount,
        interest_amount: r.interest_amount,
        note: r.note ?? "",
      })),
    );
    setRowsDirty(true);
    setAutoFillOpen(false);
  }

  // ── Interest entry modal ────────────────────────────────────────────────────
  function openInterestModal(c: ClassifiedEntry) {
    const rate = Number(annualRate) || 0;
    const expected = calcExpectedInterest(Math.abs(c.balanceBefore), rate);
    const interestType = isAsset ? "income" : "expense";
    const defaultInterestAcct =
      accounts.find((a) => a.type === interestType)?.id.toString() ?? null;
    const defaultPayment =
      accounts
        .find((a) => a.type === "asset" && a.id !== accountId)
        ?.id.toString() ?? null;
    setInterestModal({
      classified: c,
      date: c.entry.date,
      description:
        (locale === "ja" ? "利子: " : "Interest: ") +
        (c.entry.description || ""),
      amount: expected,
      interestAccountId: defaultInterestAcct,
      paymentAccountId: defaultPayment,
    });
  }

  async function handleSaveInterest() {
    if (!interestModal) return;
    const { date, description, amount, interestAccountId, paymentAccountId } =
      interestModal;
    if (!interestAccountId || !paymentAccountId || !amount) return;

    setInterestSaving(true);
    try {
      const amt = Number(amount);
      // For loan (liability): DR expense / CR asset (cash out for interest)
      // For lend  (asset):    DR asset   / CR income (cash in for interest)
      await api.journal.create({
        date,
        description,
        lines: isAsset
          ? [
              {
                account_id: Number(paymentAccountId),
                debit: amt,
                credit: 0,
              },
              {
                account_id: Number(interestAccountId),
                debit: 0,
                credit: amt,
              },
            ]
          : [
              {
                account_id: Number(interestAccountId),
                debit: amt,
                credit: 0,
              },
              {
                account_id: Number(paymentAccountId),
                debit: 0,
                credit: amt,
              },
            ],
      });
      await refresh();
      setInterestModal(null);
    } finally {
      setInterestSaving(false);
    }
  }

  // ── Auto-fill derived values ────────────────────────────────────────────────
  const derivedAutoFillMonths = useMemo(
    () =>
      fillMethod === "equal_payment" &&
      Number(fillMonthlyPayment) > 0 &&
      totalPrincipal !== ""
        ? estimateMonths(
            Number(totalPrincipal),
            Number(annualRate) || 0,
            Number(fillMonthlyPayment),
          )
        : null,
    [fillMethod, fillMonthlyPayment, totalPrincipal, annualRate],
  );

  const derivedAutoFillPayment = useMemo(
    () =>
      fillMethod === "equal_principal" &&
      Number(fillMonths) > 0 &&
      totalPrincipal !== ""
        ? calcMonthlyPayment(
            Number(totalPrincipal),
            Number(annualRate) || 0,
            Number(fillMonths),
          )
        : null,
    [fillMethod, fillMonths, totalPrincipal, annualRate],
  );

  // ── Auto-fill preview rows ──────────────────────────────────────────────────
  const previewRows = useMemo(() => {
    if (!autoFillOpen) return null;
    const total = Number(totalPrincipal);
    if (!total) return null;
    const rate = Number(annualRate) || 0;
    const start = startMonth || currentYearMonth();
    if (fillMethod === "equal_payment") {
      const payment = Number(fillMonthlyPayment);
      if (!payment || derivedAutoFillMonths === null) return null;
      return generatePlanRows({
        totalPrincipal: total,
        annualInterestRate: rate,
        startYearMonth: start,
        method: "equal_payment",
        fixedMonthlyPayment: payment,
      });
    } else {
      const months = Number(fillMonths);
      if (!months) return null;
      return generatePlanRows({
        totalPrincipal: total,
        months,
        annualInterestRate: rate,
        startYearMonth: start,
        method: "equal_principal",
      });
    }
  }, [
    autoFillOpen,
    fillMethod,
    fillMonthlyPayment,
    fillMonths,
    totalPrincipal,
    annualRate,
    startMonth,
    derivedAutoFillMonths,
  ]);

  // ── Plan totals ─────────────────────────────────────────────────────────────
  const planTotals = useMemo(() => {
    const principal = rows.reduce(
      (s, r) => s + (Number(r.principal_amount) || 0),
      0,
    );
    const interest = rows.reduce(
      (s, r) => s + (Number(r.interest_amount) || 0),
      0,
    );
    return { principal, interest };
  }, [rows]);

  // Account select options for interest modal
  const interestAccountOptions = useMemo(
    () =>
      accounts
        .filter((a) => a.type === (isAsset ? "income" : "expense"))
        .map((a) => ({ value: String(a.id), label: a.name })),
    [accounts, isAsset],
  );
  const paymentAccountOptions = useMemo(
    () =>
      accounts
        .filter((a) => a.type === "asset" && a.id !== accountId)
        .map((a) => ({ value: String(a.id), label: a.name })),
    [accounts, accountId],
  );

  if (!isCorrectKind && account) {
    return <Navigate to="/fs/db" replace />;
  }

  const color = isAsset ? "blue" : "red";

  return (
    <Stack gap="lg">
      {/* Breadcrumb */}
      <Group gap="sm">
        <Anchor component={Link} to="/fs/db" c="dimmed" size="sm">
          <Group gap={4}>
            <IconArrowLeft size={14} />
            {t("tabLoanMgmt")}
          </Group>
        </Anchor>
      </Group>

      {/* Account summary card */}
      <Card withBorder radius="md" p="md">
        <Group justify="space-between" align="flex-start">
          <Group gap="sm">
            <ThemeIcon size={40} radius="md" color={color} variant="light">
              <IconBuildingBank size={22} />
            </ThemeIcon>
            <Box>
              <Group gap={6}>
                <Text fw={700} size="lg">
                  {account?.name ?? `Account #${accountId}`}
                </Text>
                {account?.is_completed && (
                  <Badge size="sm" color="gray" variant="light">
                    {t("loanCompletedBadge")}
                  </Badge>
                )}
              </Group>
              <Text size="xs" c="dimmed">
                {isAsset
                  ? t("sectionLongTermLending")
                  : t("sectionLongTermLoan")}
              </Text>
            </Box>
          </Group>
          <Box ta="right">
            <Text size="xs" c="dimmed" fw={600}>
              {t("loanAccountBalance")}
            </Text>
            <Text
              size="xl"
              fw={800}
              c={(account?.balance ?? 0) > 0 ? color : "dimmed"}
            >
              {formatJPY(account?.balance ?? 0, locale)}
            </Text>
          </Box>
        </Group>
        <Group gap="xs" mt="sm">
          <Button
            size="xs"
            variant="light"
            color={color}
            leftSection={<IconPencil size={12} />}
            onClick={handleGoToInput}
          >
            {t("loanInputBtn")}
          </Button>
          {account?.is_completed ? (
            <Button
              size="xs"
              variant="subtle"
              color="gray"
              loading={completing}
              leftSection={<IconRefresh size={12} />}
              onClick={() => void handleForceUncomplete()}
            >
              {t("loanForceUncompleteBtn")}
            </Button>
          ) : (
            <Button
              size="xs"
              variant="subtle"
              color="green"
              loading={completing}
              leftSection={<IconCheck size={12} />}
              onClick={() => void handleForceComplete()}
            >
              {t("loanForceCompleteBtn")}
            </Button>
          )}
        </Group>
      </Card>

      {/* Plan settings */}
      <Paper withBorder radius="md" p="lg">
        <Text fw={700} mb="md">
          {t("loanDetailPlanHeader")}
        </Text>
        {planLoading ? (
          <Stack gap="sm">
            <Skeleton height={36} />
            <Skeleton height={36} />
          </Stack>
        ) : (
          <Stack gap="sm">
            <Group grow>
              <NumberInput
                label={t("loanDetailTotalPrincipal")}
                value={totalPrincipal}
                onChange={setTotalPrincipal}
                min={0}
                thousandSeparator=","
                allowDecimal={false}
              />
              <NumberInput
                label={t("loanDetailAnnualRate")}
                value={annualRate}
                onChange={setAnnualRate}
                min={0}
                max={100}
                decimalScale={2}
                suffix="%"
                description={
                  avgImpliedRate !== null
                    ? `${t("loanImpliedRate")}: ${avgImpliedRate.toFixed(2)}%`
                    : undefined
                }
              />
              <MonthPickerInput
                label={t("loanDetailStartMonth")}
                placeholder="YYYY-MM"
                value={
                  startMonth && /^\d{4}-\d{2}$/.test(startMonth)
                    ? new Date(startMonth + "-01")
                    : null
                }
                onChange={(date) => {
                  if (!date) {
                    setStartMonth("");
                    return;
                  }
                  const d = date as Date;
                  setStartMonth(
                    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
                  );
                }}
                clearable
                valueFormat="YYYY-MM"
              />
            </Group>
            <TextInput
              label={t("loanDetailNote")}
              value={planNote}
              onChange={(e) => setPlanNote(e.currentTarget.value)}
            />
            <Group justify="flex-end">
              <Button
                size="sm"
                loading={headerSaving}
                leftSection={
                  headerSaved ? (
                    <IconCheck size={14} />
                  ) : (
                    <IconDeviceFloppy size={14} />
                  )
                }
                color={headerSaved ? "green" : color}
                onClick={() => void handleSaveHeader()}
              >
                {headerSaved ? t("loanDetailSaved") : t("loanDetailSavePlan")}
              </Button>
            </Group>
          </Stack>
        )}
      </Paper>

      {/* Repayment schedule (plan rows) */}
      <Paper withBorder radius="md" p="lg">
        <Group justify="space-between" mb="md">
          <Text fw={700}>{t("loanDetailPlanRows")}</Text>
          <Group gap="xs">
            <Button
              size="xs"
              variant="light"
              color={color}
              leftSection={<IconMathFunction size={14} />}
              onClick={() => setAutoFillOpen(true)}
            >
              {t("loanDetailAutoFill")}
            </Button>
            <Button
              size="xs"
              variant="light"
              color="gray"
              leftSection={<IconPlus size={14} />}
              onClick={handleAddRow}
            >
              {t("loanDetailAddRow")}
            </Button>
          </Group>
        </Group>

        {rows.length === 0 ? (
          <Text size="sm" c="dimmed">
            {t("loanDetailNoPlan")}
          </Text>
        ) : (
          <ScrollArea>
            <Table striped withTableBorder>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{t("loanDetailMonth")}</Table.Th>
                  <Table.Th className="currency-cell">
                    {t("loanDetailPrincipal")}
                  </Table.Th>
                  <Table.Th className="currency-cell">
                    {t("loanDetailInterest")}
                  </Table.Th>
                  <Table.Th>{t("loanDetailRowNote")}</Table.Th>
                  <Table.Th />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {rows.map((row, idx) => (
                  <Table.Tr key={idx}>
                    <Table.Td>
                      <TextInput
                        size="xs"
                        value={row.year_month}
                        onChange={(e) => {
                          const v = e.currentTarget.value;
                          setRows((prev) =>
                            prev.map((r, i) =>
                              i === idx ? { ...r, year_month: v } : r,
                            ),
                          );
                          setRowsDirty(true);
                        }}
                        w={110}
                        placeholder="YYYY-MM"
                      />
                    </Table.Td>
                    <Table.Td ta="right">
                      <NumberInput
                        size="xs"
                        value={row.principal_amount}
                        onChange={(v) => {
                          setRows((prev) =>
                            prev.map((r, i) =>
                              i === idx ? { ...r, principal_amount: v } : r,
                            ),
                          );
                          setRowsDirty(true);
                        }}
                        min={0}
                        thousandSeparator=","
                        allowDecimal={false}
                        w={120}
                        styles={{ input: { textAlign: "right" } }}
                      />
                    </Table.Td>
                    <Table.Td ta="right">
                      <NumberInput
                        size="xs"
                        value={row.interest_amount}
                        onChange={(v) => {
                          setRows((prev) =>
                            prev.map((r, i) =>
                              i === idx ? { ...r, interest_amount: v } : r,
                            ),
                          );
                          setRowsDirty(true);
                        }}
                        min={0}
                        thousandSeparator=","
                        allowDecimal={false}
                        w={120}
                        styles={{ input: { textAlign: "right" } }}
                      />
                    </Table.Td>
                    <Table.Td>
                      <TextInput
                        size="xs"
                        value={row.note}
                        onChange={(e) => {
                          const v = e.currentTarget.value;
                          setRows((prev) =>
                            prev.map((r, i) =>
                              i === idx ? { ...r, note: v } : r,
                            ),
                          );
                          setRowsDirty(true);
                        }}
                        w={160}
                      />
                    </Table.Td>
                    <Table.Td>
                      <Tooltip label={t("loanDetailDeleteRow")}>
                        <ActionIcon
                          size="sm"
                          color="red"
                          variant="subtle"
                          onClick={() => void handleDeleteRow(idx)}
                        >
                          <IconTrash size={14} />
                        </ActionIcon>
                      </Tooltip>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
              <Table.Tfoot>
                <Table.Tr>
                  <Table.Td>
                    <Text size="sm" fw={700}>
                      {locale === "ja" ? "合計" : "Total"}
                    </Text>
                  </Table.Td>
                  <Table.Td className="currency-cell">
                    <Text size="sm" fw={700} c={color}>
                      {formatJPY(planTotals.principal, locale)}
                    </Text>
                  </Table.Td>
                  <Table.Td className="currency-cell">
                    <Text size="sm" fw={700} c="orange">
                      {formatJPY(planTotals.interest, locale)}
                    </Text>
                  </Table.Td>
                  <Table.Td colSpan={2} />
                </Table.Tr>
              </Table.Tfoot>
            </Table>
          </ScrollArea>
        )}

        <Group justify="space-between" mt="md" align="center">
          {rowsDirty && (
            <Text size="xs" c="orange">
              {t("loanDetailUnsavedWarning")}
            </Text>
          )}
          <Box style={{ marginLeft: "auto" }}>
            <Button
              size="sm"
              loading={rowsSaving}
              leftSection={
                rowsSaved ? (
                  <IconCheck size={14} />
                ) : (
                  <IconDeviceFloppy size={14} />
                )
              }
              color={rowsSaved ? "green" : color}
              onClick={() => void handleSaveRows()}
            >
              {rowsSaved ? t("loanDetailSaved") : t("loanDetailSaveRows")}
            </Button>
          </Box>
        </Group>
      </Paper>

      {/* Transaction history */}
      <Paper withBorder radius="md" p="lg">
        <Group justify="space-between" mb="md">
          <Text fw={700}>{t("loanHistoryTitle")}</Text>
          {avgImpliedRate !== null && (
            <Badge color="orange" variant="light">
              {t("loanImpliedRate")}: {avgImpliedRate.toFixed(2)}%
            </Badge>
          )}
        </Group>

        {classifiedHistory.length === 0 ? (
          <Text size="sm" c="dimmed">
            {t("loanNoEntries")}
          </Text>
        ) : (
          <ScrollArea>
            <Table withTableBorder striped>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{t("loanHistoryDate")}</Table.Th>
                  <Table.Th>{t("loanHistoryDesc")}</Table.Th>
                  <Table.Th className="currency-cell">
                    {t("loanHistoryPrincipal")}
                  </Table.Th>
                  <Table.Th className="currency-cell">
                    {t("loanHistoryFee")}
                  </Table.Th>
                  {Number(annualRate) > 0 && (
                    <Table.Th className="currency-cell">
                      {t("loanHistoryExpectedFee")}
                    </Table.Th>
                  )}
                  <Table.Th className="currency-cell">
                    {t("loanHistoryBalance")}
                  </Table.Th>
                  <Table.Th ta="right">{t("loanHistoryRate")}</Table.Th>
                  <Table.Th />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {[...classifiedHistory].reverse().map((c) => {
                  const isIncrease = c.principalChange > 0;
                  const isRepayment = c.principalChange < 0;
                  const rate = isRepayment
                    ? impliedAnnualRate(c.feeAmount, c.balanceBefore)
                    : null;
                  const expectedFee =
                    isRepayment && Number(annualRate) > 0
                      ? calcExpectedInterest(
                          Math.abs(c.balanceBefore),
                          Number(annualRate),
                        )
                      : null;
                  const showAddInterest =
                    isRepayment && Number(annualRate) > 0 && c.feeAmount === 0;

                  return (
                    <Table.Tr key={c.entry.id}>
                      <Table.Td>
                        <Text size="sm" style={{ whiteSpace: "nowrap" }}>
                          {c.entry.date}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm" lineClamp={1} maw={200}>
                          {c.entry.description || "—"}
                        </Text>
                      </Table.Td>
                      <Table.Td className="currency-cell">
                        <Text
                          size="sm"
                          fw={600}
                          c={
                            isIncrease ? color : isRepayment ? "teal" : "dimmed"
                          }
                          style={{ whiteSpace: "nowrap" }}
                        >
                          {c.principalChange > 0 ? "+" : ""}
                          {formatJPY(c.principalChange, locale)}
                        </Text>
                      </Table.Td>
                      <Table.Td className="currency-cell">
                        <Text
                          size="sm"
                          c={c.feeAmount > 0 ? "orange" : "dimmed"}
                          style={{ whiteSpace: "nowrap" }}
                        >
                          {c.feeAmount > 0
                            ? formatJPY(c.feeAmount, locale)
                            : "—"}
                        </Text>
                      </Table.Td>
                      {Number(annualRate) > 0 && (
                        <Table.Td className="currency-cell">
                          <Text
                            size="sm"
                            c={expectedFee !== null ? "orange" : "dimmed"}
                            style={{ whiteSpace: "nowrap" }}
                          >
                            {expectedFee !== null
                              ? formatJPY(expectedFee, locale)
                              : "—"}
                          </Text>
                        </Table.Td>
                      )}
                      <Table.Td className="currency-cell">
                        <Text
                          size="sm"
                          fw={700}
                          c={c.balanceAfter > 0 ? color : "dimmed"}
                          style={{ whiteSpace: "nowrap" }}
                        >
                          {formatJPY(c.balanceAfter, locale)}
                        </Text>
                      </Table.Td>
                      <Table.Td ta="right">
                        <Text size="sm" c={rate !== null ? "orange" : "dimmed"}>
                          {rate !== null ? `${rate.toFixed(1)}%` : "—"}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        {showAddInterest && (
                          <Button
                            size="xs"
                            variant="light"
                            color="orange"
                            onClick={() => openInterestModal(c)}
                          >
                            {t("loanAddInterestBtn")}
                          </Button>
                        )}
                      </Table.Td>
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
          </ScrollArea>
        )}
      </Paper>

      {/* Monthly plan vs actual comparison */}
      <Paper withBorder radius="md" p="lg">
        <Text fw={700} mb="md">
          {t("loanDetailComparison")}
        </Text>
        {monthlyComparison.length === 0 ? (
          <Text size="sm" c="dimmed">
            {t("loanDetailCompNoData")}
          </Text>
        ) : (
          <ScrollArea>
            <Table withTableBorder striped>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{t("loanDetailMonth")}</Table.Th>
                  <Table.Th className="currency-cell">
                    {t("loanDetailCompPlanned")} {t("loanDetailCompPrincipal")}
                  </Table.Th>
                  <Table.Th className="currency-cell">
                    {t("loanDetailCompPlanned")} {t("loanDetailCompInterest")}
                  </Table.Th>
                  <Table.Th className="currency-cell">
                    {t("loanDetailCompActual")} {t("loanDetailCompPrincipal")}
                  </Table.Th>
                  <Table.Th className="currency-cell">
                    {t("loanDetailCompActual")} {t("loanDetailCompInterest")}
                  </Table.Th>
                  <Table.Th className="currency-cell">
                    {t("loanDetailCompDiff")}
                  </Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {[...monthlyComparison].reverse().map((row) => {
                  const diff = row.diff_principal;
                  const hasPlan =
                    row.planned_principal > 0 || row.planned_interest > 0;
                  const hasActual =
                    row.actual_repayment > 0 || row.actual_fee > 0;
                  const diffColor =
                    !hasPlan && !hasActual
                      ? "dimmed"
                      : Math.abs(diff) < 1
                        ? "teal"
                        : "orange";

                  return (
                    <Table.Tr key={row.year_month}>
                      <Table.Td>
                        <Stack gap={2}>
                          <Text size="sm" fw={500}>
                            {formatYearMonth(row.year_month, locale)}
                          </Text>
                          {row.actual_borrowing > 0 && (
                            <Badge size="xs" color={color} variant="dot">
                              {locale === "ja" ? "新規" : "New"} +
                              {formatJPY(row.actual_borrowing, locale)}
                            </Badge>
                          )}
                        </Stack>
                      </Table.Td>
                      <Table.Td className="currency-cell">
                        <Text size="sm" c={hasPlan ? color : "dimmed"}>
                          {hasPlan
                            ? formatJPY(row.planned_principal, locale)
                            : "—"}
                        </Text>
                      </Table.Td>
                      <Table.Td className="currency-cell">
                        <Text
                          size="sm"
                          c={row.planned_interest > 0 ? "orange" : "dimmed"}
                        >
                          {row.planned_interest > 0
                            ? formatJPY(row.planned_interest, locale)
                            : "—"}
                        </Text>
                      </Table.Td>
                      <Table.Td className="currency-cell">
                        <Text
                          size="sm"
                          c={hasActual ? "teal" : "dimmed"}
                          fw={hasActual ? 600 : undefined}
                        >
                          {hasActual
                            ? formatJPY(row.actual_repayment, locale)
                            : "—"}
                        </Text>
                      </Table.Td>
                      <Table.Td className="currency-cell">
                        <Text
                          size="sm"
                          c={row.actual_fee > 0 ? "orange" : "dimmed"}
                        >
                          {row.actual_fee > 0
                            ? formatJPY(row.actual_fee, locale)
                            : "—"}
                        </Text>
                      </Table.Td>
                      <Table.Td className="currency-cell">
                        <Text size="sm" c={diffColor} fw={600}>
                          {!hasPlan && !hasActual
                            ? "—"
                            : diff >= 0
                              ? `+${formatJPY(diff, locale)}`
                              : formatJPY(diff, locale)}
                        </Text>
                      </Table.Td>
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
          </ScrollArea>
        )}
      </Paper>

      {/* Auto-fill modal */}
      <Modal
        opened={autoFillOpen}
        onClose={() => setAutoFillOpen(false)}
        title={t("loanDetailAutoFill")}
        size="sm"
      >
        <Stack gap="sm">
          <SegmentedControl
            value={fillMethod}
            onChange={(v) => {
              setFillMethod(v as "equal_payment" | "equal_principal");
              setFillMonthlyPayment("");
              setFillMonths("");
            }}
            data={[
              {
                label: locale === "ja" ? "月額固定" : "Fixed Payment",
                value: "equal_payment",
              },
              {
                label: locale === "ja" ? "月数指定" : "By Months",
                value: "equal_principal",
              },
            ]}
            fullWidth
            size="sm"
          />
          <NumberInput
            label={t("loanDetailAutoFillPayment")}
            value={
              fillMethod === "equal_payment"
                ? fillMonthlyPayment
                : (derivedAutoFillPayment ?? "")
            }
            onChange={setFillMonthlyPayment}
            disabled={fillMethod === "equal_principal"}
            min={1}
            thousandSeparator=","
            allowDecimal={false}
            description={
              fillMethod === "equal_payment" &&
              Number(fillMonthlyPayment) > 0 &&
              derivedAutoFillMonths === null
                ? locale === "ja"
                  ? "返済額が利息を下回っています"
                  : "Payment does not cover interest"
                : fillMethod === "equal_principal"
                  ? locale === "ja"
                    ? "自動計算"
                    : "Auto-calculated"
                  : undefined
            }
          />
          <NumberInput
            label={t("loanDetailAutoFillMonths")}
            value={
              fillMethod === "equal_principal"
                ? fillMonths
                : (derivedAutoFillMonths ?? "")
            }
            onChange={setFillMonths}
            disabled={fillMethod === "equal_payment"}
            min={1}
            max={600}
            description={
              fillMethod === "equal_payment"
                ? locale === "ja"
                  ? "自動計算"
                  : "Auto-calculated"
                : undefined
            }
          />
          <Text size="xs" c="dimmed">
            {locale === "ja"
              ? `元本: ${totalPrincipal || "?"} / 年利: ${annualRate || 0}% / 開始: ${startMonth || currentYearMonth()}`
              : `Principal: ${totalPrincipal || "?"} / Rate: ${annualRate || 0}% / Start: ${startMonth || currentYearMonth()}`}
          </Text>
          {previewRows &&
            previewRows.length > 0 &&
            (() => {
              const last = previewRows[previewRows.length - 1];
              const totalInterest = previewRows.reduce(
                (s, r) => s + r.interest_amount,
                0,
              );
              if (fillMethod === "equal_payment") {
                const normalPayment = Number(fillMonthlyPayment);
                const lastTotal = last.principal_amount + last.interest_amount;
                const diff = lastTotal - normalPayment;
                return (
                  <Box
                    p="xs"
                    style={{
                      background: "var(--mantine-color-default-hover)",
                      borderRadius: 4,
                    }}
                  >
                    <Stack gap={2}>
                      <Text size="xs" c="dimmed">
                        {locale === "ja"
                          ? `全 ${previewRows.length} 回 / 利子総額: ${formatJPY(totalInterest, locale)}`
                          : `${previewRows.length} payments / Total interest: ${formatJPY(totalInterest, locale)}`}
                      </Text>
                      {diff !== 0 && (
                        <Text size="xs" c="orange">
                          {locale === "ja"
                            ? `最終月 (${last.year_month}): ${formatJPY(lastTotal, locale)}（通常比 ${diff > 0 ? "+" : ""}${formatJPY(diff, locale)}）`
                            : `Last month (${last.year_month}): ${formatJPY(lastTotal, locale)} (${diff > 0 ? "+" : ""}${formatJPY(diff, locale)} vs normal)`}
                        </Text>
                      )}
                    </Stack>
                  </Box>
                );
              } else {
                const first = previewRows[0];
                const firstTotal =
                  first.principal_amount + first.interest_amount;
                const lastTotal = last.principal_amount + last.interest_amount;
                const principalDiff =
                  last.principal_amount - first.principal_amount;
                return (
                  <Box
                    p="xs"
                    style={{
                      background: "var(--mantine-color-default-hover)",
                      borderRadius: 4,
                    }}
                  >
                    <Stack gap={2}>
                      <Text size="xs" c="dimmed">
                        {locale === "ja"
                          ? `利子総額: ${formatJPY(totalInterest, locale)} / 初月: ${formatJPY(firstTotal, locale)} → 最終月: ${formatJPY(lastTotal, locale)}`
                          : `Total interest: ${formatJPY(totalInterest, locale)} / First: ${formatJPY(firstTotal, locale)} → Last: ${formatJPY(lastTotal, locale)}`}
                      </Text>
                      {principalDiff !== 0 && (
                        <Text size="xs" c="orange">
                          {locale === "ja"
                            ? `最終月元本: ${formatJPY(last.principal_amount, locale)}（通常比 ${principalDiff > 0 ? "+" : ""}${formatJPY(principalDiff, locale)}）`
                            : `Last principal: ${formatJPY(last.principal_amount, locale)} (${principalDiff > 0 ? "+" : ""}${formatJPY(principalDiff, locale)} vs normal)`}
                        </Text>
                      )}
                    </Stack>
                  </Box>
                );
              }
            })()}
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setAutoFillOpen(false)}>
              {locale === "ja" ? "キャンセル" : "Cancel"}
            </Button>
            <Button
              color={color}
              onClick={handleAutoFill}
              disabled={
                !totalPrincipal ||
                (fillMethod === "equal_payment"
                  ? !fillMonthlyPayment || derivedAutoFillMonths === null
                  : !fillMonths)
              }
            >
              {t("loanDetailAutoFillConfirm")}
            </Button>
          </Group>
        </Stack>
      </Modal>

      {/* Interest entry modal */}
      <Modal
        opened={interestModal !== null}
        onClose={() => setInterestModal(null)}
        title={t("loanInterestModalTitle")}
        size="md"
      >
        {interestModal && (
          <Stack gap="sm">
            <Group grow>
              <TextInput
                label={t("loanDetailMonth")}
                value={interestModal.date}
                onChange={(e) =>
                  setInterestModal((m) =>
                    m ? { ...m, date: e.currentTarget.value } : m,
                  )
                }
              />
            </Group>
            <TextInput
              label={locale === "ja" ? "摘要" : "Description"}
              value={interestModal.description}
              onChange={(e) =>
                setInterestModal((m) =>
                  m ? { ...m, description: e.currentTarget.value } : m,
                )
              }
            />
            <NumberInput
              label={t("loanInterestAmountLabel")}
              value={interestModal.amount}
              onChange={(v) =>
                setInterestModal((m) => (m ? { ...m, amount: v } : m))
              }
              min={0}
              thousandSeparator=","
              allowDecimal={false}
            />
            <Divider />
            <Select
              label={t("loanInterestAccount")}
              placeholder={locale === "ja" ? "科目を選択" : "Select account"}
              data={interestAccountOptions}
              value={interestModal.interestAccountId}
              onChange={(v) =>
                setInterestModal((m) =>
                  m ? { ...m, interestAccountId: v } : m,
                )
              }
            />
            <Select
              label={t("loanInterestPaymentAccount")}
              placeholder={
                locale === "ja" ? "決済口座を選択" : "Select account"
              }
              data={paymentAccountOptions}
              value={interestModal.paymentAccountId}
              onChange={(v) =>
                setInterestModal((m) => (m ? { ...m, paymentAccountId: v } : m))
              }
            />
            <Text size="xs" c="dimmed">
              {isAsset
                ? locale === "ja"
                  ? "仕訳: 決済口座（借方）/ 収益科目（貸方）"
                  : "Entry: payment account (DR) / income account (CR)"
                : locale === "ja"
                  ? "仕訳: 費用科目（借方）/ 決済口座（貸方）"
                  : "Entry: expense account (DR) / payment account (CR)"}
            </Text>
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setInterestModal(null)}>
                {locale === "ja" ? "キャンセル" : "Cancel"}
              </Button>
              <Button
                color="orange"
                loading={interestSaving}
                disabled={
                  !interestModal.interestAccountId ||
                  !interestModal.paymentAccountId ||
                  !interestModal.amount
                }
                onClick={() => void handleSaveInterest()}
              >
                {locale === "ja" ? "仕訳を作成" : "Create Entry"}
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </Stack>
  );
}
