import {
  Alert,
  Box,
  Button,
  Group,
  Modal,
  Paper,
  Stack,
  Table,
  Text,
} from "@mantine/core";
import { IconAlertTriangle, IconCircleCheck } from "@tabler/icons-react";
import { useMemo, useState } from "react";
import type { JournalEntry } from "@balance-sheet/shared";
import { api } from "../../api/client";
import { useLang } from "../../i18n";
import { useAppData } from "../../context/AppDataContext";
import { showFeedback } from "../../lib/feedback";
import { formatJPY } from "../../lib/numberFormat";
import { useAccountDisplayName } from "./ttUtils";

export function UnknownFundsSection() {
  const { t, locale } = useLang();
  const { accounts, journal, refresh } = useAppData();
  const getDisplayName = useAccountDisplayName();
  const [processing, setProcessing] = useState<number | null>(null);
  const [confirmEntry, setConfirmEntry] = useState<{
    entry: JournalEntry;
    mode: "misc";
  } | null>(null);

  const unknownFundsAccount = accounts.find(
    (a) => a.name === "__system:unknown_funds__",
  );
  const miscExpenseAccount = accounts.find(
    (a) => a.name === "__system:misc_expense__",
  );
  const miscIncomeAccount = accounts.find(
    (a) => a.name === "__system:misc_income__",
  );

  // Find journal entries involving the 不明金 account
  const unknownFundEntries = useMemo(() => {
    if (!unknownFundsAccount) return [];
    return journal.filter((e) =>
      e.lines.some((l) => l.account_id === unknownFundsAccount.id),
    );
  }, [journal, unknownFundsAccount]);

  async function handleProcessMisc(entry: JournalEntry) {
    if (!unknownFundsAccount || !miscExpenseAccount || !miscIncomeAccount)
      return;

    const ufLines = entry.lines.filter(
      (l) => l.account_id === unknownFundsAccount.id,
    );

    setProcessing(entry.id);
    try {
      for (const ufLine of ufLines) {
        // If 不明金 was debited (missing money) → 雑損 (expense) takes over
        // If 不明金 was credited (extra money) → 雑益 (income) takes over
        const ufBalance = ufLine.debit - ufLine.credit;
        const amount = Math.abs(ufBalance);

        let debitAcctId: number;
        let creditAcctId: number;

        if (ufBalance > 0) {
          // 不明金 has debit balance → missing money → expense
          debitAcctId = miscExpenseAccount.id;
          creditAcctId = unknownFundsAccount.id;
        } else {
          // 不明金 has credit balance → extra money → income
          debitAcctId = unknownFundsAccount.id;
          creditAcctId = miscIncomeAccount.id;
        }

        await api.journal.create({
          date: entry.date,
          description:
            locale === "ja"
              ? `雑損・雑益処理 - ${entry.description}`
              : `Misc reclassification - ${entry.description}`,
          lines: [
            { account_id: debitAcctId, debit: amount, credit: 0 },
            { account_id: creditAcctId, debit: 0, credit: amount },
          ],
          budget_source: "multiline",
        });
      }
      showFeedback({ message: t("ttUnknownFundsProcessed"), color: "teal" });
      setConfirmEntry(null);
      await refresh();
    } catch {
      showFeedback({ message: t("saveFailed"), color: "red" });
    } finally {
      setProcessing(null);
    }
  }

  if (!unknownFundsAccount) {
    return (
      <Alert color="yellow" variant="light">
        {locale === "ja"
          ? "Unknown funds account not found. Please apply the database migration."
          : "Unknown funds account not found. Please apply the database migration."}
      </Alert>
    );
  }

  if (unknownFundEntries.length === 0) {
    return (
      <Alert color="teal" icon={<IconCircleCheck size={16} />} variant="light">
        {t("ttUnknownFundsEmpty")}
      </Alert>
    );
  }

  return (
    <Stack gap="md">
      <Text size="sm" c="dimmed">
        {t("ttUnknownFundsTitle")}
      </Text>
      {unknownFundEntries.map((entry) => {
        const ufLine = entry.lines.find(
          (l) => l.account_id === unknownFundsAccount.id,
        );
        const ufBalance = ufLine ? ufLine.debit - ufLine.credit : 0;

        return (
          <Paper key={entry.id} withBorder p="md" radius="md">
            <Group justify="space-between" wrap="wrap" gap="xs">
              <Box>
                <Text size="sm" fw={600}>
                  {entry.date} — {entry.description}
                </Text>
                <Text size="xs" c="dimmed">
                  {"Unknown funds balance"}:{" "}
                  <Text
                    span
                    fw={600}
                    c={ufBalance > 0 ? "red" : "teal"}
                    size="xs"
                  >
                    {ufBalance >= 0 ? "+" : ""}
                    {formatJPY(ufBalance, locale)}
                  </Text>
                </Text>
                <Box mt={4}>
                  {entry.lines.map((l) => (
                    <Text key={l.id} size="xs" c="dimmed">
                      {l.debit > 0
                        ? `DR ${getDisplayName(l.account_name)} ¥${l.debit.toLocaleString()}`
                        : `CR ${getDisplayName(l.account_name)} ¥${l.credit.toLocaleString()}`}
                    </Text>
                  ))}
                </Box>
              </Box>
              <Button
                size="xs"
                variant="light"
                color="grape"
                loading={processing === entry.id}
                onClick={() => setConfirmEntry({ entry, mode: "misc" })}
              >
                {t("ttUnknownFundsMiscLoss")}
              </Button>
            </Group>
          </Paper>
        );
      })}

      <Modal
        opened={confirmEntry !== null}
        onClose={() => setConfirmEntry(null)}
        title={t("ttUnknownFundsMiscTitle")}
      >
        {confirmEntry && (
          <Stack gap="md">
            <Alert
              color="yellow"
              variant="light"
              icon={<IconAlertTriangle size={16} />}
            >
              {t("ttMiscReclassWarning")}
            </Alert>
            <Text size="sm">{t("ttUnknownFundsMiscConfirm")}</Text>
            {(() => {
              const entry = confirmEntry.entry;
              const ufLine = entry.lines.find(
                (l) => l.account_id === unknownFundsAccount.id,
              );
              const ufBalance = ufLine ? ufLine.debit - ufLine.credit : 0;
              const amount = Math.abs(ufBalance);
              const isExpense = ufBalance > 0;
              return (
                <Table fz="sm" withRowBorders>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>{locale === "ja" ? "借方" : "Debit"}</Table.Th>
                      <Table.Th>{locale === "ja" ? "貸方" : "Credit"}</Table.Th>
                      <Table.Th className="currency-cell">Amount</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    <Table.Tr>
                      <Table.Td>
                        {isExpense ? t("sysMiscExpense") : t("sysUnknownFunds")}
                      </Table.Td>
                      <Table.Td>
                        {isExpense ? t("sysUnknownFunds") : t("sysMiscIncome")}
                      </Table.Td>
                      <Table.Td className="currency-cell">
                        {formatJPY(amount, locale)}
                      </Table.Td>
                    </Table.Tr>
                  </Table.Tbody>
                </Table>
              );
            })()}
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setConfirmEntry(null)}>
                {t("cancel")}
              </Button>
              <Button
                color="grape"
                loading={processing === confirmEntry.entry.id}
                onClick={() => handleProcessMisc(confirmEntry.entry)}
              >
                {t("confirm")}
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </Stack>
  );
}
