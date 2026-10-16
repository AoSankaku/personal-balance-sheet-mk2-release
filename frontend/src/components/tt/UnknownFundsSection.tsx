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
import { getEffectiveSymbol } from "../../lib/currencyUtils";
import { formatCurrency } from "../../lib/numberFormat";
import { useAccountDisplayName } from "./ttUtils";

export function UnknownFundsSection() {
  const { t, locale } = useLang();
  const { accounts, journal, refresh, enabledCurrencies } = useAppData();
  const getDisplayName = useAccountDisplayName();
  const [processing, setProcessing] = useState<number | null>(null);
  const [confirmEntry, setConfirmEntry] = useState<{
    entry: JournalEntry;
    mode: "misc";
  } | null>(null);

  const unknownFundsAccount = accounts.find(
    (a) => a.name === "__system:unknown_funds__",
  );
  const formatAmount = (amount: number, currency: string | null | undefined) => {
    const code = (currency || "JPY").toUpperCase();
    return formatCurrency(
      amount,
      locale,
      code,
      getEffectiveSymbol(code, enabledCurrencies),
    );
  };

  // Find journal entries involving the 不明金 account
  const unknownFundEntries = useMemo(() => {
    if (!unknownFundsAccount) return [];
    return journal.filter((entry) =>
      entry.lines.some(
        (line) =>
          line.account_id === unknownFundsAccount.id &&
          (line.debit !== 0 || line.credit !== 0),
      ),
    );
  }, [journal, unknownFundsAccount]);

  async function handleProcessMisc(entry: JournalEntry) {
    if (!unknownFundsAccount) return;

    setProcessing(entry.id);
    try {
      await api.trialBalance.resolveUnknownFunds(entry.id);
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
        const unknownLines = entry.lines.filter(
          (line) =>
            line.account_id === unknownFundsAccount.id &&
            (line.debit !== 0 || line.credit !== 0),
        );
        const unknownBalances = new Map<string, number>();
        for (const line of unknownLines) {
          const currency = (line.currency || "JPY").toUpperCase();
          unknownBalances.set(
            currency,
            (unknownBalances.get(currency) ?? 0) + line.debit - line.credit,
          );
        }

        return (
          <Paper key={entry.id} withBorder p="md" radius="md">
            <Group justify="space-between" wrap="wrap" gap="xs">
              <Box>
                <Text size="sm" fw={600}>
                  {entry.date} — {entry.description}
                </Text>
                <Text size="xs" c="dimmed">
                  {t("ttUnknownFundsBalance")}: {" "}
                  {[...unknownBalances.entries()].map(([currency, balance]) => (
                    <Text
                      key={currency}
                      span
                      fw={600}
                      c={balance > 0 ? "red" : "teal"}
                      size="xs"
                    >
                      {balance >= 0 ? "+" : ""}
                      {formatAmount(balance, currency)}{" "}
                    </Text>
                  ))}
                </Text>
                <Box mt={4}>
                  {entry.lines
                    .filter(
                      (line) =>
                        line.account_id !== unknownFundsAccount.id ||
                        line.debit !== 0 ||
                        line.credit !== 0,
                    )
                    .map((l) => (
                      <Text key={l.id} size="xs" c="dimmed">
                        {l.debit > 0
                          ? `DR ${getDisplayName(l.account_name)} ${formatAmount(l.debit, l.currency)}`
                          : `CR ${getDisplayName(l.account_name)} ${formatAmount(l.credit, l.currency)}`}
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
            <Text size="sm">{t("ttUnknownFundsReclassConfirm")}</Text>
            {(() => {
              const entry = confirmEntry.entry;
              const unknownLines = entry.lines.filter(
                (line) =>
                  line.account_id === unknownFundsAccount.id &&
                  (line.debit !== 0 || line.credit !== 0),
              );
              return (
                <Table fz="sm" withRowBorders>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>{t("ttUnknownFundsDebit")}</Table.Th>
                      <Table.Th>{t("ttUnknownFundsCredit")}</Table.Th>
                      <Table.Th className="currency-cell">
                        {t("ttUnknownFundsAmount")}
                      </Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {unknownLines.map((line) => {
                      const isExpense = line.debit > 0;
                      const amount = line.debit + line.credit;
                      return (
                        <Table.Tr key={line.id}>
                          <Table.Td>
                            {isExpense
                              ? t("sysMiscExpense")
                              : t("sysUnknownFunds")}
                          </Table.Td>
                          <Table.Td>
                            {isExpense
                              ? t("sysUnknownFunds")
                              : t("sysMiscIncome")}
                          </Table.Td>
                          <Table.Td className="currency-cell">
                            {formatAmount(amount, line.currency)}
                          </Table.Td>
                        </Table.Tr>
                      );
                    })}
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
