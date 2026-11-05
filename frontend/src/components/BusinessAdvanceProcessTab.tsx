import {
  Alert,
  Anchor,
  Button,
  Divider,
  Group,
  NumberInput,
  Paper,
  ScrollArea,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { DateInput } from "@mantine/dates";
import dayjs from "dayjs";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { useLang } from "../i18n";
import { useAppData } from "../context/AppDataContext";
import { showFeedback } from "../lib/feedback";
import {
  isUserSelectableAccount,
  toAccountSelectOption,
} from "../lib/accountUtils";
import { renderAccountOption } from "../lib/accountSelect";
import { formatCurrency } from "../lib/numberFormat";
import { isBudgetAccount, isBudgetAsset } from "../../../shared/budgetScope";
import {
  buildBusinessAdvanceJournalPayload,
  fromCurrencyMinorUnits,
  sumCurrencyBalance,
  toCurrencyMinorUnits,
  type BusinessAdvanceEntryKind,
} from "../lib/businessAdvance";

export function BusinessAdvanceProcessTab({ onDone }: { onDone: () => void }) {
  const { t, locale } = useLang();
  const {
    accounts,
    budgetCategories,
    budgetSettings,
    journal,
    displayCurrency,
    displayCurrencySymbol,
    enabledCurrencies,
  } = useAppData();
  const currency = displayCurrency || "JPY";
  const decimalPlaces = enabledCurrencies.find((item) => item.code === currency)?.decimal_places ?? 0;
  const [mode, setMode] = useState<BusinessAdvanceEntryKind>("send");
  const [date, setDate] = useState<Date | null>(new Date());
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState<number>(0);
  const sendSourceCandidates = accounts
    .filter(
      (account) =>
        account.type === "asset" &&
        account.category === "cash" &&
        account.id !== budgetSettings?.business_advance_account_id &&
        isUserSelectableAccount(account),
    )
    .sort((a, b) => a.name.localeCompare(b.name, "ja"));
  const preferredSourceId = (budgetSettings?.preferred_payment_account_ids ?? [])
    .find((id) => sendSourceCandidates.some((account) => account.id === id))
    ?? sendSourceCandidates[0]?.id;
  const defaultSendFromId = preferredSourceId == null ? null : String(preferredSourceId);
  const [sendFromId, setSendFromId] = useState<string | null>(defaultSendFromId);
  const [transferToId, setTransferToId] = useState<string | null>(null);
  const [budgetCategoryId, setBudgetCategoryId] = useState<string | null>(() => {
    const configuredId = budgetSettings?.business_advance_budget_category_id;
    return configuredId != null && budgetCategories.some((item) => item.id === configuredId)
      ? String(configuredId)
      : null;
  });
  const [lossAccountId, setLossAccountId] = useState<string | null>(
    budgetSettings?.business_loss_account_id
      ? String(budgetSettings.business_loss_account_id)
      : null,
  );
  const [submitting, setSubmitting] = useState(false);

  const advanceAccount = accounts.find(
    (a) => a.id === budgetSettings?.business_advance_account_id,
  );

  const assetOptions = accounts
    .filter(
      (a) =>
        a.type === "asset" &&
        a.id !== budgetSettings?.business_advance_account_id &&
        isUserSelectableAccount(a),
    )
    .map((a) => toAccountSelectOption(a, t));

  const sendSourceAccounts = sendSourceCandidates.filter(
    (account) => account.id !== advanceAccount?.id,
  );
  const sendSourceOptions = sendSourceAccounts.map((a) => toAccountSelectOption(a, t));
  const selectedSendSource = sendSourceAccounts.find((a) => String(a.id) === sendFromId);
  const budgetOptions = budgetCategories
    .filter((category) => !category.is_archived)
    .map((category) => ({ value: String(category.id), label: category.name }));
  const selectedBusinessBudget = budgetOptions.some(
    (category) => category.value === budgetCategoryId,
  );

  const selectedDate = dayjs(date ?? new Date()).format("YYYY-MM-DD");
  const normalizeCurrency = (value: string | null | undefined) =>
    (value || "JPY").toUpperCase();
  const advanceBalance = advanceAccount
    ? sumCurrencyBalance(
        journal
          .filter((entry) => entry.date.slice(0, 10) <= selectedDate)
          .flatMap((entry) => entry.lines)
          .filter((line) =>
            line.account_id === advanceAccount.id &&
            normalizeCurrency(line.currency) === normalizeCurrency(currency),
          ),
        decimalPlaces,
      )
    : 0;

  const historyRows = useMemo(() => {
    if (!advanceAccount) return [];
    const entries = journal
      .filter((entry) => entry.date.slice(0, 10) <= selectedDate)
      .slice()
      .sort(
        (a, b) =>
          a.date.localeCompare(b.date) ||
          a.created_at.localeCompare(b.created_at) ||
          a.id - b.id,
      );
    let runningMinorUnits = 0;
    return entries.flatMap((entry) => {
      const lines = entry.lines.filter((candidate) =>
        candidate.account_id === advanceAccount.id &&
        normalizeCurrency(candidate.currency) === normalizeCurrency(currency),
      );
      if (lines.length === 0) return [];
      const debitMinorUnits = lines.reduce(
        (total, line) => total + toCurrencyMinorUnits(line.debit, decimalPlaces),
        0,
      );
      const creditMinorUnits = lines.reduce(
        (total, line) => total + toCurrencyMinorUnits(line.credit, decimalPlaces),
        0,
      );
      runningMinorUnits += debitMinorUnits - creditMinorUnits;
      return [{
        id: entry.id,
        date: entry.date,
        description: entry.description,
        debit: fromCurrencyMinorUnits(debitMinorUnits, decimalPlaces),
        credit: fromCurrencyMinorUnits(creditMinorUnits, decimalPlaces),
        balance: fromCurrencyMinorUnits(runningMinorUnits, decimalPlaces),
      }];
    });
  }, [journal, advanceAccount, selectedDate, currency, decimalPlaces]);

  const expenseOptions = accounts
    .filter((a) => a.type === "expense" && isUserSelectableAccount(a))
    .map((a) => toAccountSelectOption(a, t));

  async function handleSubmit() {
    if (!advanceAccount || !date || !Number.isFinite(amount) || amount <= 0) return;
    if (isBudgetAsset(advanceAccount)) return;
    if (mode !== "send" && amount > Math.max(advanceBalance, 0)) return;
    if (mode === "send" && !sendSourceAccounts.some((account) => String(account.id) === sendFromId)) return;
    if (mode === "recover" && !transferToId) return;
    if (mode === "dispose" && !lossAccountId) return;

    setSubmitting(true);
    try {
      const dateStr = dayjs(date).format("YYYY-MM-DD");
      const kindDescription: Record<BusinessAdvanceEntryKind, string> = {
        send: t("businessAdvanceSendDesc"),
        recover: t("businessAdvanceTransferDesc"),
        dispose: t("businessAdvanceDisposeDesc"),
      };
      const otherAccountId =
        mode === "send"
          ? Number(sendFromId)
          : mode === "recover"
            ? Number(transferToId)
            : Number(lossAccountId);
      const otherAccount = accounts.find((account) => account.id === otherAccountId);
      if (
        !otherAccount ||
        (mode === "send" &&
          (otherAccount.type !== "asset" || otherAccount.category !== "cash")) ||
        (mode === "recover" && otherAccount.type !== "asset") ||
        (mode === "dispose" && otherAccount.type !== "expense")
      ) {
        return;
      }
      const payload = buildBusinessAdvanceJournalPayload({
        kind: mode,
        date: dateStr,
        description: description || kindDescription[mode],
        amount,
        currency,
        decimalPlaces,
        advanceAccount,
        otherAccount,
        budgetCategoryId:
          mode === "send" && selectedBusinessBudget && budgetCategoryId != null
            ? Number(budgetCategoryId)
            : null,
      });
      await api.journal.create(payload);
      showFeedback({ message: t("entrySaved"), color: "teal" });
      setAmount(0);
      setDescription("");
      setSendFromId(defaultSendFromId);
      setTransferToId(null);
      onDone();
    } catch {
      showFeedback({ message: t("saveFailed"), color: "red" });
    } finally {
      setSubmitting(false);
    }
  }

  if (!advanceAccount) {
    return (
      <Stack pt="md">
        <Text size="sm" c="dimmed">
          {t("businessAdvanceAccountNotSet")}
        </Text>
        <Anchor component={Link} to="/settings" size="sm">
          {t("goToSettings")}
        </Anchor>
      </Stack>
    );
  }

  if (isBudgetAsset(advanceAccount)) {
    return (
      <Stack pt="md">
        <Alert color="orange" title={t("businessAdvanceAccountBudgetWarningTitle")}>
          {t("businessAdvanceAccountBudgetWarning")}
          <Anchor component={Link} to="/settings/business" size="sm" ml={4}>
            {t("goToSettings")}
          </Anchor>
        </Alert>
      </Stack>
    );
  }

  return (
    <Stack pt="md" maw={480}>
      {/* Current balance display */}
      <Paper withBorder p="sm" radius="sm">
        <Group justify="space-between">
          <Text size="sm" c="dimmed">
            {advanceAccount.name} {t("currentBalance")}
          </Text>
          <Text size="sm" fw={600} c={advanceBalance > 0 ? "blue" : "dimmed"}>
            {formatCurrency(advanceBalance, locale, currency, displayCurrencySymbol, decimalPlaces)}
          </Text>
        </Group>
      </Paper>

      <SegmentedControl
        data={[
          { value: "send", label: t("businessAdvanceSendMode") },
          { value: "recover", label: t("businessAdvanceModeTransfer") },
          { value: "dispose", label: t("businessAdvanceModeDispose") },
        ]}
        value={mode}
        onChange={(v) => setMode(v as BusinessAdvanceEntryKind)}
        fullWidth
      />

      <SimpleGrid cols={{ base: 1, sm: 2 }}>
        <DateInput
          label={t("dateLabel")}
          required
          valueFormat="YYYY-MM-DD"
          value={date}
          onChange={setDate}
        />
        <TextInput
          label={t("descriptionLabel")}
          placeholder={
              mode === "send"
                ? t("businessAdvanceSendDesc")
                : mode === "recover"
                  ? t("businessAdvanceTransferDesc")
                  : t("businessAdvanceDisposeDesc")
          }
          value={description}
          onChange={(e) => setDescription(e.currentTarget.value)}
        />
      </SimpleGrid>

      <NumberInput
        label={t("amountLabel")}
        placeholder="0"
        required
        min={0}
        decimalScale={decimalPlaces}
        max={mode !== "send" ? Math.max(advanceBalance, 0) : undefined}
        thousandSeparator=","
        prefix={displayCurrencySymbol}
        value={amount}
        onChange={(v) => setAmount(Number(v) || 0)}
      />

      {mode !== "send" && amount > Math.max(advanceBalance, 0) && (
        <Text size="sm" c="red">{t("businessAdvanceAmountExceedsBalance")}</Text>
      )}

      {mode === "send" && (
        <>
          <Select
            label={t("businessAdvanceSendFromLabel")}
            placeholder={t("selectAccount")}
            data={sendSourceOptions}
            renderOption={renderAccountOption as never}
            searchable
            required
            value={sendFromId}
            onChange={setSendFromId}
          />
          <Select
            label={t("businessAdvanceBudgetSourceLabel")}
            description={t("businessAdvanceBudgetSourceHint")}
            placeholder={t("businessAdvanceBudgetUnallocated")}
            data={budgetOptions}
            clearable
            searchable
            value={selectedBusinessBudget ? budgetCategoryId : null}
            onChange={setBudgetCategoryId}
          />
          {selectedSendSource && !isBudgetAccount(selectedSendSource) && (
            <Text size="sm" c="dimmed">{t("businessAdvanceUntrackedSourceHint")}</Text>
          )}
        </>
      )}

      {mode === "recover" && (
        <>
          <Select
            label={t("businessAdvanceTransferToLabel")}
            placeholder={t("selectAccount")}
            data={assetOptions}
            renderOption={renderAccountOption as never}
            searchable
            required
            value={transferToId}
            onChange={setTransferToId}
          />
          <Text size="sm" c="dimmed">{t("businessAdvanceRecoveryBudgetHint")}</Text>
        </>
      )}

      {mode === "dispose" && (
        <Select
          label={t("businessLossAccountLabel")}
          placeholder={t("selectAccount")}
          data={expenseOptions}
          renderOption={renderAccountOption as never}
          searchable
          required
          value={lossAccountId}
          onChange={setLossAccountId}
        />
      )}

      <Button
        onClick={() => void handleSubmit()}
        loading={submitting}
        disabled={
          amount <= 0 ||
          !date ||
          isBudgetAsset(advanceAccount) ||
          (mode === "send" && !sendSourceAccounts.some((account) => String(account.id) === sendFromId)) ||
          (mode === "recover" && (!transferToId || amount > Math.max(advanceBalance, 0))) ||
          (mode === "dispose" && (!lossAccountId || amount > Math.max(advanceBalance, 0)))
        }
      >
        {t("save")}
      </Button>

      {historyRows.length > 0 && (
        <>
          <Divider mt="md" />
          <Title order={6}>{t("businessAdvanceBalanceHistory")}</Title>
          <ScrollArea>
            <Table fz="xs" striped withTableBorder withColumnBorders>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th style={{ width: 100 }}>{t("dateLabel")}</Table.Th>
                  <Table.Th>{t("descriptionLabel")}</Table.Th>
                  <Table.Th className="currency-cell" style={{ width: 110 }}>
                    {t("changeColHeader")}
                  </Table.Th>
                  <Table.Th className="currency-cell" style={{ width: 110 }}>
                    {t("thBalance")}
                  </Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {[...historyRows].reverse().map((row) => {
                  const change = row.debit - row.credit;
                  return (
                    <Table.Tr key={row.id}>
                      <Table.Td>{row.date}</Table.Td>
                      <Table.Td>{row.description}</Table.Td>
                      <Table.Td
                        className="currency-cell"
                        c={change > 0 ? "teal" : change < 0 ? "red" : undefined}
                      >
                        {change > 0 ? "+" : ""}
                        {formatCurrency(change, locale, currency, displayCurrencySymbol, decimalPlaces)}
                      </Table.Td>
                      <Table.Td
                        className="currency-cell"
                        fw={500}
                        c={row.balance > 0 ? "blue" : "dimmed"}
                      >
                        {formatCurrency(row.balance, locale, currency, displayCurrencySymbol, decimalPlaces)}
                      </Table.Td>
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
          </ScrollArea>
        </>
      )}
    </Stack>
  );
}
