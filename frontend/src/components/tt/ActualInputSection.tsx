import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Group,
  NumberInput,
  Paper,
  SegmentedControl,
  Stack,
  Text,
} from "@mantine/core";
import { DatePickerInput } from "@mantine/dates";
import { IconTrash } from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";
import {
  deriveCreditCardStatus,
  shiftCreditCardMonth,
  statementMonthWithTransactionOffset,
} from "@balance-sheet/shared";
import type {
  Account,
  ActualBalanceSnapshot,
  CreditCardSettings,
  CreditCardStateEntry,
} from "@balance-sheet/shared";
import { ApiError, api } from "../../api/client";
import { useLang } from "../../i18n";
import { useAppData } from "../../context/AppDataContext";
import { showFeedback } from "../../lib/feedback";
import { CATEGORY_TRANSLATION_KEY } from "../../lib/accountUtils";
import { getEffectiveSymbol } from "../../lib/currencyUtils";
import { formatCurrency } from "../../lib/numberFormat";
import {
  useAccountDisplayName,
  type CreditCardDraftRow,
  type CreditCardValuesMap,
  type GeneralValuesMap,
  CREDIT_CARD_MONTH_DISPLAY_STEP,
  DEFAULT_CREDIT_CARD_VISIBLE_MONTHS,
  monthKeyFromDate,
  normalizeCreditCardRows,
  getCreditCardWindowMeta,
  formatConfiguredDay,
  formatBillingOffsetMonths,
  formatCreditCardPaymentLabel,
  fmtMD,
} from "./ttUtils";

export function ActualInputSection({
  onSaved,
  onCreditCardStateSaved,
}: {
  onSaved: (snapshot: ActualBalanceSnapshot) => void;
  onCreditCardStateSaved: (entries: CreditCardStateEntry[]) => void;
}) {
  const { t, locale } = useLang();
  const { accounts, journal, displayCurrency, enabledCurrencies } =
    useAppData();
  const getDisplayName = useAccountDisplayName();

  const [date, setDate] = useState<Date | null>(new Date());
  const [generalValues, setGeneralValues] = useState<GeneralValuesMap>({});
  const [creditCardValues, setCreditCardValues] = useState<CreditCardValuesMap>(
    {},
  );
  const [saving, setSaving] = useState(false);
  const [ccSettings, setCcSettings] = useState<CreditCardSettings[]>([]);
  const [ccState, setCcState] = useState<CreditCardStateEntry[]>([]);
  const [ccStateLoaded, setCcStateLoaded] = useState(false);
  const [mode, setMode] = useState<"general" | "credit_card">("general");
  const [creditCardVisibleMonths, setCreditCardVisibleMonths] = useState<
    Record<number, number>
  >({});

  useEffect(() => {
    api.creditCardSettings
      .list()
      .then(setCcSettings)
      .catch(() => {});
    api.trialBalance
      .getCreditCardState()
      .then((data) => {
        setCcState(data);
        setCcStateLoaded(true);
      })
      .catch(() => {
        setCcStateLoaded(true);
      });
  }, []);

  const ccSettingsMap = useMemo(
    () => new Map(ccSettings.map((s) => [s.account_id, s])),
    [ccSettings],
  );

  // dateStr derived from the selected date (local date, not UTC)
  const dateStr = date
    ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
    : null;

  // Credit cards are always relative to today — no date picker
  const _today = new Date();
  const todayStr = `${_today.getFullYear()}-${String(_today.getMonth() + 1).padStart(2, "0")}-${String(_today.getDate()).padStart(2, "0")}`;

  const normalizeCurrency = (currency: string | null | undefined) =>
    (currency || "JPY").toUpperCase();
  const accountCurrency = (account: Account) =>
    normalizeCurrency(
      Object.keys(account.balances ?? {}).find(
          (currency) => Math.abs(account.balances?.[currency] ?? 0) > 0.001,
        ) ||
        Object.keys(account.balances ?? {})[0] ||
        displayCurrency,
    );
  const currencySymbolFor = (currency: string | null | undefined) =>
    getEffectiveSymbol(normalizeCurrency(currency), enabledCurrencies);
  const formatAccountAmount = (amount: number, account: Account) =>
    formatCurrency(
      amount,
      locale,
      accountCurrency(account),
      currencySymbolFor(accountCurrency(account)),
    );

  // Compute per-account book values from local journal filtered to dateStr.
  // This re-evaluates whenever the user changes the date picker.
  const bookValueMap = useMemo(() => {
    const raw = new Map<number, number>(); // sum of (debit - credit)
    const accountMap = new Map(accounts.map((account) => [account.id, account]));
    for (const entry of journal) {
      if (dateStr && entry.date > dateStr) continue;
      for (const line of entry.lines) {
        const account = accountMap.get(line.account_id);
        if (
          account &&
          normalizeCurrency(line.currency) !==
            accountCurrency(account)
        ) {
          continue;
        }
        raw.set(
          line.account_id,
          (raw.get(line.account_id) ?? 0) + line.debit - line.credit,
        );
      }
    }
    // Flip sign for credit-normal accounts (liability / equity / income)
    const result = new Map<number, number>();
    for (const a of accounts) {
      const r = raw.get(a.id);
      if (r === undefined) {
        result.set(a.id, 0);
        continue;
      }
      const isDebitNormal = a.type === "asset" || a.type === "expense";
      result.set(a.id, isDebitNormal ? r : -r);
    }
    return result;
  }, [dateStr, journal, accounts]);

  // Assets (exclude property, crypto, system) + liabilities (except credit cards)
  const inputableAccounts = useMemo(
    () =>
      accounts.filter(
        (a) =>
          !a.is_system &&
          ((a.type === "asset" &&
            a.category !== "property" &&
            a.category !== "crypto") ||
            (a.type === "liability" && a.category !== "credit_card")),
      ),
    [accounts],
  );
  const creditCardAccounts = useMemo(
    () =>
      accounts.filter(
        (account) =>
          !account.is_system &&
          account.type === "liability" &&
          account.category === "credit_card",
      ),
    [accounts],
  );

  const assetAccounts = inputableAccounts.filter((a) => a.type === "asset");
  const liabilityAccounts = inputableAccounts.filter(
    (a) => a.type === "liability",
  );

  // ccStateMap: (account_id:payment_month) → amount — used for placeholders
  const ccStateMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const entry of ccState) {
      map.set(`${entry.account_id}:${entry.payment_month}`, entry.amount);
    }
    return map;
  }, [ccState]);
  const derivedPaymentMonthsByAccount = useMemo(() => {
    const map = new Map<number, Set<string>>();
    for (const entry of journal) {
      for (const line of entry.lines) {
        const setting = ccSettingsMap.get(line.account_id);
        if (
          !setting ||
          line.credit_card_billing_offset_months == null ||
          line.credit_card_billing_offset_months < 0
        ) {
          continue;
        }
        const paymentMonth = statementMonthWithTransactionOffset(
          entry.date,
          setting.closing_day,
          line.credit_card_billing_offset_months,
        );
        if (!map.has(line.account_id)) {
          map.set(line.account_id, new Set<string>());
        }
        map.get(line.account_id)!.add(paymentMonth);
      }
    }
    return map;
  }, [journal, ccSettingsMap]);

  // Seed form from DB once ccState has loaded. Runs only once; user edits are preserved.
  useEffect(() => {
    if (!ccStateLoaded) return;
    const currentMonth = monthKeyFromDate(todayStr);
    setCreditCardValues(() => {
      const next: CreditCardValuesMap = {};
      for (const account of creditCardAccounts) {
        const seedRows: CreditCardDraftRow[] = ccState
          .filter((entry) => entry.account_id === account.id)
          .map((entry) => ({
            id: `seed-${entry.account_id}-${entry.payment_month}`,
            payment_month: entry.payment_month,
            amount: entry.amount,
            status: entry.status,
          }));
        for (const paymentMonth of derivedPaymentMonthsByAccount.get(
          account.id,
        ) ?? []) {
          if (!seedRows.some((row) => row.payment_month === paymentMonth)) {
            seedRows.push({
              id: `derived-${account.id}-${paymentMonth}`,
              payment_month: paymentMonth,
              amount: "",
              status: paymentMonth === currentMonth ? "open" : "confirmed",
            });
          }
        }
        next[account.id] = normalizeCreditCardRows(seedRows, currentMonth);
      }
      return next;
    });
    // Only run once when DB data first arrives; creditCardAccounts changes are handled separately.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    ccStateLoaded,
    derivedPaymentMonthsByAccount,
    todayStr,
    creditCardAccounts,
  ]);

  async function handleSave() {
    setSaving(true);
    try {
      if (mode === "credit_card") {
        const entries = creditCardAccounts.flatMap((account) =>
          (creditCardValues[account.id] ?? []).flatMap((row) => {
            if (
              row.amount === "" ||
              row.amount === undefined ||
              row.amount === null
            )
              return [];
            const settings = ccSettingsMap.get(account.id);
            return [
              {
                account_id: account.id,
                payment_month: row.payment_month,
                amount: Number(row.amount),
                status: deriveCreditCardStatus(
                  todayStr,
                  row.payment_month,
                  settings,
                ),
              },
            ];
          }),
        );
        if (entries.length === 0) return;
        const saved = await api.trialBalance.saveCreditCardState({ entries });
        setCcState(saved);
        onCreditCardStateSaved(saved);
        showFeedback({ message: t("ttActualInputSaved"), color: "teal" });
        return;
      }

      // mode === "general"
      if (!date || !dateStr) return;
      const general_entries = inputableAccounts.flatMap((account) => {
        const value = generalValues[account.id];
        if (value === "" || value === undefined || value === null) return [];
        return [{ account_id: account.id, amount: Number(value) }];
      });
      if (general_entries.length === 0) return;

      const now = new Date();
      const isToday =
        date.getFullYear() === now.getFullYear() &&
        date.getMonth() === now.getMonth() &&
        date.getDate() === now.getDate();
      const hh = isToday ? String(now.getHours()).padStart(2, "0") : "23";
      const mm = isToday ? String(now.getMinutes()).padStart(2, "0") : "59";

      const snapshot = await api.trialBalance.createSnapshot({
        snapshot_date: dateStr,
        snapshot_time: `${hh}:${mm}`,
        general_entries,
      });
      showFeedback({ message: t("ttActualInputSaved"), color: "teal" });
      onSaved(snapshot);
    } catch (error) {
      showFeedback({
        message: error instanceof ApiError ? error.message : t("saveFailed"),
        color: "red",
      });
    } finally {
      setSaving(false);
    }
  }

  if (inputableAccounts.length === 0 && creditCardAccounts.length === 0) {
    return (
      <Text c="dimmed" size="sm">
        {t("ttActualInputNoAccounts")}
      </Text>
    );
  }

  function renderAccountRow(a: Account) {
    const value = generalValues[a.id] ?? "";
    const bookValue = bookValueMap.get(a.id) ?? a.balance ?? 0;
    return (
      <Group key={a.id} justify="space-between" align="center">
        <Stack gap={0} style={{ flex: 1 }}>
          <Text size="sm" fw={500}>
            {getDisplayName(a.name)}
          </Text>
          <Text size="xs" c="dimmed">
            {CATEGORY_TRANSLATION_KEY[
              a.category as keyof typeof CATEGORY_TRANSLATION_KEY
            ]
              ? t(
                  CATEGORY_TRANSLATION_KEY[
                    a.category as keyof typeof CATEGORY_TRANSLATION_KEY
                  ],
                )
              : a.category}
            {" · "}
            {`${t("ttDeviationBookValue")}: ${formatAccountAmount(bookValue, a)}`}
          </Text>
        </Stack>
        <NumberInput
          value={value}
          onChange={(v) => setGeneralValues((prev) => ({ ...prev, [a.id]: v }))}
          placeholder={`${currencySymbolFor(accountCurrency(a))}${Math.round(bookValue).toLocaleString("en-US")}`}
          min={0}
          thousandSeparator=","
          prefix={currencySymbolFor(accountCurrency(a))}
          w={160}
          size="sm"
          hideControls
        />
      </Group>
    );
  }

  function setCreditCardRow(
    accountId: number,
    rowId: string,
    patch: Partial<CreditCardDraftRow>,
  ) {
    setCreditCardValues((prev) => {
      const currentRows = prev[accountId] ?? [];
      const targetRow = currentRows.find((row) => row.id === rowId);
      const nextMonth = patch.payment_month;
      if (
        targetRow &&
        nextMonth &&
        currentRows.some(
          (row) => row.id !== rowId && row.payment_month === nextMonth,
        )
      ) {
        showFeedback({
          message:
            locale === "ja"
              ? "同じ年月は重複して入力できません"
              : "Duplicate payment months are not allowed",
          color: "red",
        });
        return prev;
      }

      return {
        ...prev,
        [accountId]: normalizeCreditCardRows(
          currentRows.map((row) =>
            row.id === rowId ? { ...row, ...patch } : row,
          ),
          monthKeyFromDate(todayStr),
        ),
      };
    });
  }

  function addConfirmedRow(accountId: number) {
    const currentMonth = monthKeyFromDate(todayStr);
    setCreditCardVisibleMonths((prev) => ({
      ...prev,
      [accountId]:
        (prev[accountId] ?? DEFAULT_CREDIT_CARD_VISIBLE_MONTHS) +
        CREDIT_CARD_MONTH_DISPLAY_STEP,
    }));
    setCreditCardValues((prev) => {
      const currentRows = prev[accountId] ?? [];
      const oldestMonth = currentRows.reduce(
        (min, row) => (row.payment_month < min ? row.payment_month : min),
        currentMonth,
      );
      const newRows = Array.from({ length: 3 }, (_, i) => ({
        id: crypto.randomUUID(),
        payment_month: shiftCreditCardMonth(oldestMonth, -(i + 1)),
        amount: "" as const,
        status: "confirmed" as const,
      }));
      return {
        ...prev,
        [accountId]: normalizeCreditCardRows(
          [...currentRows, ...newRows],
          currentMonth,
        ),
      };
    });
  }

  function removeConfirmedRow(accountId: number, rowId: string) {
    const currentMonth = monthKeyFromDate(todayStr);
    setCreditCardValues((prev) => ({
      ...prev,
      [accountId]: normalizeCreditCardRows(
        (prev[accountId] ?? []).filter((row) => row.id !== rowId),
        currentMonth,
      ),
    }));
  }

  function showMoreCreditCardRows(accountId: number) {
    setCreditCardVisibleMonths((prev) => ({
      ...prev,
      [accountId]:
        (prev[accountId] ?? DEFAULT_CREDIT_CARD_VISIBLE_MONTHS) +
        CREDIT_CARD_MONTH_DISPLAY_STEP,
    }));
  }

  function renderCreditCardAccount(account: Account) {
    const rows = creditCardValues[account.id] ?? [];
    const setting = ccSettingsMap.get(account.id);
    const currentMonth = monthKeyFromDate(todayStr);
    const visibleMonthCount =
      creditCardVisibleMonths[account.id] ?? DEFAULT_CREDIT_CARD_VISIBLE_MONTHS;
    const oldestVisibleMonth = shiftCreditCardMonth(
      currentMonth,
      -(visibleMonthCount - 1),
    );
    const visibleRows = rows.filter(
      (row) => row.payment_month >= oldestVisibleMonth,
    );
    const hiddenRows = rows.filter(
      (row) => row.payment_month < oldestVisibleMonth,
    );
    const total = rows.reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
    return (
      <Paper key={account.id} withBorder p="md" radius="md">
        <Stack gap="sm">
          <Group justify="space-between" align="flex-start">
            <Stack gap={0}>
              <Text size="sm" fw={600}>
                {getDisplayName(account.name)}
              </Text>
              <Text size="xs" c="dimmed">
                {`${t("closingDayLabel")} ${setting ? formatConfiguredDay(setting.closing_day, locale) : "?"} / ${t("withdrawalDayLabel")} ${setting ? formatConfiguredDay(setting.withdrawal_day, locale) : "?"} / ${setting ? formatBillingOffsetMonths(setting.billing_offset_months, locale) : "?"}`}
              </Text>
            </Stack>
            <Text size="sm" fw={700}>
              {formatAccountAmount(total, account)}
            </Text>
          </Group>

          {visibleRows.map((row) => {
            const meta = getCreditCardWindowMeta(
              todayStr,
              row.payment_month,
              setting,
              locale,
            );
            const isCurrentMonthRow = row.payment_month === currentMonth;
            const paymentLabel = formatCreditCardPaymentLabel(
              row.payment_month,
              setting,
              locale,
            );
            return (
              <Paper
                key={row.id}
                withBorder
                p="xs"
                radius="sm"
                bg="var(--mantine-color-default-hover)"
              >
                <Box hiddenFrom="sm">
                  <Stack gap={6}>
                    <Group justify="space-between" align="center">
                      <Group gap="xs" align="center">
                        <Text size="sm" fw={600}>
                          {paymentLabel}
                        </Text>
                        <Badge
                          size="sm"
                          color={
                            meta.status === "open"
                              ? "blue"
                              : meta.status === "paid"
                                ? "green"
                                : "orange"
                          }
                          variant="light"
                        >
                          {meta.status === "open"
                            ? t("ttCcStatusOpen")
                            : meta.status === "paid"
                              ? t("ttCcStatusPaid")
                              : t("ttCcStatusConfirmed")}
                        </Badge>
                      </Group>
                      {!isCurrentMonthRow && (
                        <ActionIcon
                          color="red"
                          variant="subtle"
                          size="sm"
                          onClick={() => removeConfirmedRow(account.id, row.id)}
                        >
                          <IconTrash size={14} />
                        </ActionIcon>
                      )}
                    </Group>
                    {meta.period && (
                      <Text size="xs" c="dimmed">
                        {`${t("ttCcUsageHint")}: ${meta.periodLabel} / ${meta.paymentDate ? fmtMD(meta.paymentDate, locale) : "?"}`}
                      </Text>
                    )}
                    <Group justify="flex-end" align="center" wrap="nowrap">
                      <Text size="sm" fw={500}>
                        {t("ttDeviationActualValue")}
                      </Text>
                      <NumberInput
                        value={row.amount}
                        onChange={(value) =>
                          setCreditCardRow(account.id, row.id, {
                            amount: value,
                          })
                        }
                        min={0}
                        thousandSeparator=","
                        prefix={currencySymbolFor(accountCurrency(account))}
                        hideControls
                        size="md"
                        inputMode="numeric"
                        w={180}
                        placeholder={(() => {
                          const dbVal = ccStateMap.get(
                            `${account.id}:${row.payment_month}`,
                          );
                          return dbVal !== undefined
                            ? `${currencySymbolFor(accountCurrency(account))}${Math.round(dbVal).toLocaleString("en-US")}`
                            : undefined;
                        })()}
                      />
                    </Group>
                  </Stack>
                </Box>
                <Box visibleFrom="sm">
                  <Group
                    justify="space-between"
                    align="flex-start"
                    wrap="nowrap"
                  >
                    <Stack gap={6} style={{ flex: 1 }}>
                      <Group gap="xs" align="center">
                        <Text size="sm" fw={600}>
                          {paymentLabel}
                        </Text>
                        <Badge
                          size="sm"
                          color={
                            meta.status === "open"
                              ? "blue"
                              : meta.status === "paid"
                                ? "green"
                                : "orange"
                          }
                          variant="light"
                        >
                          {meta.status === "open"
                            ? t("ttCcStatusOpen")
                            : meta.status === "paid"
                              ? t("ttCcStatusPaid")
                              : t("ttCcStatusConfirmed")}
                        </Badge>
                      </Group>
                      {meta.period && (
                        <Text size="xs" c="dimmed">
                          {`${t("ttCcUsageHint")}: ${meta.periodLabel} / ${meta.paymentDate ? fmtMD(meta.paymentDate, locale) : "?"}`}
                        </Text>
                      )}
                    </Stack>
                    <Group justify="flex-end" align="center" wrap="nowrap">
                      <Text size="sm" fw={500}>
                        {t("ttDeviationActualValue")}
                      </Text>
                      <NumberInput
                        value={row.amount}
                        onChange={(value) =>
                          setCreditCardRow(account.id, row.id, {
                            amount: value,
                          })
                        }
                        min={0}
                        thousandSeparator=","
                        prefix={currencySymbolFor(accountCurrency(account))}
                        hideControls
                        size="md"
                        inputMode="numeric"
                        w={180}
                        placeholder={(() => {
                          const dbVal = ccStateMap.get(
                            `${account.id}:${row.payment_month}`,
                          );
                          return dbVal !== undefined
                            ? `${currencySymbolFor(accountCurrency(account))}${Math.round(dbVal).toLocaleString("en-US")}`
                            : undefined;
                        })()}
                      />
                      <Box
                        w={28}
                        h={28}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        {!isCurrentMonthRow && (
                          <ActionIcon
                            color="red"
                            variant="subtle"
                            size="sm"
                            onClick={() =>
                              removeConfirmedRow(account.id, row.id)
                            }
                          >
                            <IconTrash size={14} />
                          </ActionIcon>
                        )}
                      </Box>
                    </Group>
                  </Group>
                </Box>
              </Paper>
            );
          })}

          <Group justify="space-between">
            <Button
              size="xs"
              variant="light"
              onClick={() =>
                hiddenRows.length > 0
                  ? showMoreCreditCardRows(account.id)
                  : addConfirmedRow(account.id)
              }
            >
              {hiddenRows.length > 0 ? t("ttCcShowMoreMonths") : t("ttCcAddMonth")}
            </Button>
            <Stack gap={0} align="flex-end">
              {hiddenRows.length > 0 && (
                <Text size="xs" c="dimmed">
                  {t("ttCcHiddenMonths").replace(
                    "{n}",
                    String(hiddenRows.length),
                  )}
                </Text>
              )}
              <Text size="xs" c="dimmed">
                {t("ccSlotTotal")}: {formatAccountAmount(total, account)}
              </Text>
            </Stack>
          </Group>
        </Stack>
      </Paper>
    );
  }

  const hasGeneralEntries = inputableAccounts.some((account) => {
    const value = generalValues[account.id];
    return value !== "" && value !== undefined && value !== null;
  });
  const hasCreditCardEntries = creditCardAccounts.some((account) =>
    (creditCardValues[account.id] ?? []).some(
      (row) =>
        row.amount !== "" && row.amount !== undefined && row.amount !== null,
    ),
  );
  const hasEntries =
    mode === "general" ? hasGeneralEntries : hasCreditCardEntries;

  return (
    <Stack gap="md">
      <Text size="sm" c="dimmed">
        {t("ttActualInputDesc")}
      </Text>
      <SegmentedControl
        value={mode}
        onChange={(value) => setMode(value as "general" | "credit_card")}
        data={[
          { value: "general", label: t("ttActualModeGeneral") },
          { value: "credit_card", label: t("ttActualModeCreditCard") },
        ]}
      />
      {mode === "general" ? (
        <>
          <DatePickerInput
            label={t("ttActualInputDate")}
            value={date}
            onChange={setDate}
            valueFormat="YYYY/MM/DD"
            w={200}
            size="sm"
          />
          <Text size="sm" c="dimmed">
            {t("ttActualGeneralDesc")}
          </Text>
          {assetAccounts.length > 0 && (
            <Paper withBorder p="md" radius="md">
              <Text fw={600} size="sm" mb="sm">
                {t("ttActualSectionAssets")}
              </Text>
              <Stack gap="sm">{assetAccounts.map(renderAccountRow)}</Stack>
            </Paper>
          )}
          {liabilityAccounts.length > 0 && (
            <Paper withBorder p="md" radius="md">
              <Text fw={600} size="sm" mb="sm">
                {t("ttActualSectionLiabilities")}
              </Text>
              <Stack gap="sm">{liabilityAccounts.map(renderAccountRow)}</Stack>
            </Paper>
          )}
        </>
      ) : (
        <>
          <Text size="sm" c="dimmed">
            {t("ttActualCreditCardDesc")}
          </Text>
          {creditCardAccounts.length === 0 ? (
            <Text size="sm" c="dimmed">
              {t("ttCcNoAccounts")}
            </Text>
          ) : (
            <Stack gap="sm">
              {creditCardAccounts.map(renderCreditCardAccount)}
            </Stack>
          )}
        </>
      )}
      <Button
        onClick={handleSave}
        loading={saving}
        disabled={(mode === "general" && !date) || !hasEntries}
        w="fit-content"
      >
        {t("ttActualInputSubmit")}
      </Button>
    </Stack>
  );
}
