import {
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
import { formatJPY } from "../lib/numberFormat";

export function BusinessAdvanceProcessTab({ onDone }: { onDone: () => void }) {
  const { t, locale } = useLang();
  const { accounts, budgetSettings, journal } = useAppData();
  const [mode, setMode] = useState<"transfer" | "dispose">("transfer");
  const [date, setDate] = useState<Date | null>(new Date());
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState<number>(0);
  const [transferToId, setTransferToId] = useState<string | null>(null);
  const [lossAccountId, setLossAccountId] = useState<string | null>(
    budgetSettings?.business_loss_account_id
      ? String(budgetSettings.business_loss_account_id)
      : null,
  );
  const [submitting, setSubmitting] = useState(false);

  const advanceAccount = accounts.find(
    (a) => a.id === budgetSettings?.business_advance_account_id,
  );

  const advanceBalance = advanceAccount?.balance ?? 0;

  const historyRows = useMemo(() => {
    if (!advanceAccount) return [];
    const entries = journal
      .filter((e) => e.lines.some((l) => l.account_id === advanceAccount.id))
      .slice()
      .sort((a, b) => a.date.localeCompare(b.date));
    let running = 0;
    return entries.map((e) => {
      const line = e.lines.find((l) => l.account_id === advanceAccount.id)!;
      running += line.debit - line.credit;
      return {
        id: e.id,
        date: e.date,
        description: e.description,
        debit: line.debit,
        credit: line.credit,
        balance: running,
      };
    });
  }, [journal, advanceAccount]);

  const assetOptions = accounts
    .filter(
      (a) =>
        a.type === "asset" &&
        a.id !== budgetSettings?.business_advance_account_id &&
        isUserSelectableAccount(a),
    )
    .map((a) => toAccountSelectOption(a, t));

  const expenseOptions = accounts
    .filter((a) => a.type === "expense" && isUserSelectableAccount(a))
    .map((a) => toAccountSelectOption(a, t));

  async function handleSubmit() {
    if (!advanceAccount || amount <= 0 || !date) return;
    if (mode === "transfer" && !transferToId) return;
    if (mode === "dispose" && !lossAccountId) return;

    setSubmitting(true);
    try {
      const dateStr = dayjs(date).format("YYYY-MM-DD");
      if (mode === "transfer") {
        await api.journal.create({
          date: dateStr,
          description: description || t("businessAdvanceTransferDesc"),
          lines: [
            { account_id: Number(transferToId), debit: amount, credit: 0 },
            { account_id: advanceAccount.id, debit: 0, credit: amount },
          ],
          budget_source: "simple",
        });
      } else {
        const lossAcc = accounts.find((a) => a.id === Number(lossAccountId));
        const budget_allocations = lossAcc?.budget_ratios
          ?.filter((r) => r.ratio > 0)
          .map((r) => ({
            budget_category_id: r.budget_category_id,
            amount: -Math.round(amount * (r.ratio / 100)),
          }));
        await api.journal.create({
          date: dateStr,
          description: description || t("businessAdvanceDisposeDesc"),
          lines: [
            { account_id: Number(lossAccountId), debit: amount, credit: 0 },
            { account_id: advanceAccount.id, debit: 0, credit: amount },
          ],
          budget_source: "simple",
          budget_allocations:
            budget_allocations && budget_allocations.length > 0
              ? budget_allocations
              : undefined,
        });
      }
      showFeedback({ message: t("entrySaved"), color: "teal" });
      setAmount(0);
      setDescription("");
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

  return (
    <Stack pt="md" maw={480}>
      {/* Current balance display */}
      <Paper withBorder p="sm" radius="sm">
        <Group justify="space-between">
          <Text size="sm" c="dimmed">
            {advanceAccount.name} {t("currentBalance")}
          </Text>
          <Text size="sm" fw={600} c={advanceBalance > 0 ? "blue" : "dimmed"}>
            ¥{advanceBalance.toLocaleString()}
          </Text>
        </Group>
      </Paper>

      <SegmentedControl
        data={[
          { value: "transfer", label: t("businessAdvanceModeTransfer") },
          { value: "dispose", label: t("businessAdvanceModeDispose") },
        ]}
        value={mode}
        onChange={(v) => setMode(v as "transfer" | "dispose")}
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
            mode === "transfer"
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
        max={advanceBalance > 0 ? advanceBalance : undefined}
        thousandSeparator=","
        prefix="¥"
        value={amount}
        onChange={(v) => setAmount(Number(v) || 0)}
      />

      {mode === "transfer" && (
        <Select
          label={t("businessAdvanceTransferToLabel")}
          placeholder={t("selectAccount")}
          data={assetOptions}
          searchable
          required
          value={transferToId}
          onChange={setTransferToId}
        />
      )}

      {mode === "dispose" && (
        <Select
          label={t("businessLossAccountLabel")}
          placeholder={t("selectAccount")}
          data={expenseOptions}
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
          (mode === "transfer" && !transferToId) ||
          (mode === "dispose" && !lossAccountId)
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
                        {formatJPY(change, locale)}
                      </Table.Td>
                      <Table.Td
                        className="currency-cell"
                        fw={500}
                        c={row.balance > 0 ? "blue" : "dimmed"}
                      >
                        {formatJPY(row.balance, locale)}
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
