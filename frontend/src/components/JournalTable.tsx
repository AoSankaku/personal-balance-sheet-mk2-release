import {
  ActionIcon,
  Badge,
  Group,
  ScrollArea,
  Stack,
  Table,
  Text,
  Title,
  Tooltip,
} from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { IconPencil, IconTrash } from "@tabler/icons-react";
import type { Account, JournalEntry } from "@balance-sheet/shared";
import { useLang } from "../i18n";
import { formatCurrency } from "../lib/numberFormat";

interface Props {
  entries: JournalEntry[];
  accounts: Account[];
  onDelete: (id: number) => void;
  onEdit?: (entry: JournalEntry) => void;
  view?: "simple" | "double";
  showTimestamp?: boolean;
  displayCurrency?: string;
}

function normalizeCurrency(currency: string | null | undefined) {
  return (currency || "JPY").toUpperCase();
}

function lineMatchesCurrency(
  line: JournalEntry["lines"][number],
  currency?: string,
) {
  if (!currency) return true;
  return normalizeCurrency(line.currency) === normalizeCurrency(currency);
}

export function JournalTable({
  entries,
  accounts,
  onDelete,
  onEdit,
  view = "double",
  showTimestamp = false,
  displayCurrency,
}: Props) {
  const { t, locale } = useLang();
  const isMobile = useMediaQuery("(max-width: 48em)");

  function formatTimestamp(ts: string) {
    const d = new Date(ts.replace(" ", "T"));
    if (isNaN(d.getTime())) return ts;
    return new Intl.DateTimeFormat(locale === "ja" ? "ja-JP" : "en-US", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(d);
  }
  const accountTypeMap = new Map(accounts.map((a) => [a.id, a.type]));
  const formatAmount = (amount: number, currency?: string) =>
    formatCurrency(amount, locale, normalizeCurrency(currency));

  return (
    <Stack gap="xs">
      <Title order={5}>{t("recentJournalEntries")}</Title>
      {view === "simple" ? (
        <ScrollArea>
          <Table
            striped
            highlightOnHover
            withTableBorder
            withColumnBorders
            style={{ minWidth: 520 }}
          >
            <Table.Thead>
              <Table.Tr>
                <Table.Th style={{ whiteSpace: "nowrap", width: "1%" }}>
                  {t("thDate")}
                </Table.Th>
                <Table.Th>{t("thDescription")}</Table.Th>
                <Table.Th style={{ whiteSpace: "nowrap", width: "1%" }}>
                  {t("thSource")}
                </Table.Th>
                <Table.Th className="currency-cell">
                  {t("amountLabel")}
                </Table.Th>
                <Table.Th>{t("thAccount")}</Table.Th>
                {showTimestamp && (
                  <Table.Th style={{ width: 140 }}>{t("thCreatedAt")}</Table.Th>
                )}
                <Table.Th style={{ width: 80 }} />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {entries.length === 0 ? (
                <Table.Tr>
                  <Table.Td colSpan={showTimestamp ? 7 : 6}>
                    <Text c="dimmed" ta="center" size="sm" py="xs">
                      {t("noTransactionsYet")}
                    </Text>
                  </Table.Td>
                </Table.Tr>
              ) : (
                entries.map((entry) => {
                  const debitLines = entry.lines.filter(
                    (l) =>
                      l.debit > 0 && lineMatchesCurrency(l, displayCurrency),
                  );
                  const creditLines = entry.lines.filter(
                    (l) =>
                      l.credit > 0 && lineMatchesCurrency(l, displayCurrency),
                  );
                  const selectedLines = [...debitLines, ...creditLines];
                  const isPositive = creditLines.some((l) => {
                    const t = accountTypeMap.get(l.account_id);
                    return t === "income" || t === "equity";
                  });
                  const debitAmount = debitLines.reduce(
                    (s, l) => s + l.debit,
                    0,
                  );
                  const creditAmount = creditLines.reduce(
                    (s, l) => s + l.credit,
                    0,
                  );
                  const netAmount =
                    debitAmount > 0 ? debitAmount : creditAmount;
                  const amountCurrency = selectedLines[0]?.currency;
                  const accountName = (
                    debitLines.length > 0 ? debitLines : selectedLines
                  )
                    .map((l) => l.account_name)
                    .join(", ");
                  return (
                    <Table.Tr key={entry.id}>
                      <Table.Td style={{ whiteSpace: "nowrap" }}>
                        <Text size="sm">{entry.date}</Text>
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm" fw={500}>
                          {entry.description}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        {entry.source === "csv_import" ? (
                          <Badge size="xs" color="violet" variant="light">
                            {isMobile ? "CSV" : t("journalSourceCsvImport")}
                          </Badge>
                        ) : (
                          <Badge size="xs" color="gray" variant="light">
                            {isMobile ? "手動" : t("journalSourceManual")}
                          </Badge>
                        )}
                      </Table.Td>
                      <Table.Td className="currency-cell">
                        {isPositive ? (
                          <Text size="sm" fw={700} c="green">
                            +{formatAmount(netAmount, amountCurrency)}
                          </Text>
                        ) : (
                          <Text size="sm">
                            -{formatAmount(netAmount, amountCurrency)}
                          </Text>
                        )}
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm" c="dimmed">
                          {accountName}
                        </Text>
                      </Table.Td>
                      {showTimestamp && (
                        <Table.Td>
                          <Text size="xs" c="dimmed">
                            {formatTimestamp(entry.created_at)}
                          </Text>
                        </Table.Td>
                      )}
                      <Table.Td>
                        <Group gap={4} wrap="nowrap">
                          {onEdit && (
                            <Tooltip label={t("editLabel")}>
                              <ActionIcon
                                variant="subtle"
                                size="sm"
                                onClick={() => onEdit(entry)}
                              >
                                <IconPencil size={14} />
                              </ActionIcon>
                            </Tooltip>
                          )}
                          <Tooltip label={t("deleteEntry")}>
                            <ActionIcon
                              variant="subtle"
                              color="red"
                              size="sm"
                              onClick={() => onDelete(entry.id)}
                            >
                              <IconTrash size={14} />
                            </ActionIcon>
                          </Tooltip>
                        </Group>
                      </Table.Td>
                    </Table.Tr>
                  );
                })
              )}
            </Table.Tbody>
          </Table>
        </ScrollArea>
      ) : (
        <ScrollArea>
          <Table
            striped
            highlightOnHover
            withTableBorder
            withColumnBorders
            style={{ minWidth: 580 }}
          >
            <Table.Thead>
              <Table.Tr>
                <Table.Th style={{ whiteSpace: "nowrap", width: "1%" }}>
                  {t("thDate")}
                </Table.Th>
                <Table.Th>{t("thDescription")}</Table.Th>
                <Table.Th style={{ whiteSpace: "nowrap", width: "1%" }}>
                  {t("thSource")}
                </Table.Th>
                <Table.Th className="currency-cell">{t("thDebit")}</Table.Th>
                <Table.Th className="currency-cell">{t("thCredit")}</Table.Th>
                {showTimestamp && (
                  <Table.Th style={{ width: 140 }}>{t("thCreatedAt")}</Table.Th>
                )}
                <Table.Th style={{ width: 80 }} />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {entries.length === 0 ? (
                <Table.Tr>
                  <Table.Td colSpan={showTimestamp ? 7 : 6}>
                    <Text c="dimmed" ta="center" size="sm" py="xs">
                      {t("noTransactionsYet")}
                    </Text>
                  </Table.Td>
                </Table.Tr>
              ) : (
                entries.map((entry) => {
                  const debitLines = entry.lines.filter(
                    (l) =>
                      l.debit > 0 && lineMatchesCurrency(l, displayCurrency),
                  );
                  const creditLines = entry.lines.filter(
                    (l) =>
                      l.credit > 0 && lineMatchesCurrency(l, displayCurrency),
                  );

                  return (
                    <Table.Tr key={entry.id}>
                      <Table.Td style={{ whiteSpace: "nowrap" }}>
                        <Text size="sm">{entry.date}</Text>
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm" fw={500}>
                          {entry.description}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        {entry.source === "csv_import" ? (
                          <Badge size="xs" color="violet" variant="light">
                            {isMobile ? "CSV" : t("journalSourceCsvImport")}
                          </Badge>
                        ) : (
                          <Badge size="xs" color="gray" variant="light">
                            {isMobile ? "手動" : t("journalSourceManual")}
                          </Badge>
                        )}
                      </Table.Td>
                      <Table.Td className="currency-cell">
                        <Stack gap={2}>
                          {debitLines.map((l) => (
                            <Group key={l.id} gap={6} wrap="nowrap">
                              <Badge size="xs" color="blue" variant="light">
                                {l.account_name}
                              </Badge>
                              <Text size="xs" className="currency-token">
                                {formatAmount(l.debit, l.currency)}
                              </Text>
                              {l.currency && l.currency !== "JPY" && (
                                <Badge size="xs" color="teal" variant="outline">
                                  {l.currency}
                                </Badge>
                              )}
                            </Group>
                          ))}
                        </Stack>
                      </Table.Td>
                      <Table.Td className="currency-cell">
                        <Stack gap={2}>
                          {creditLines.map((l) => (
                            <Group key={l.id} gap={6} wrap="nowrap">
                              <Badge size="xs" color="orange" variant="light">
                                {l.account_name}
                              </Badge>
                              <Text size="xs" className="currency-token">
                                {formatAmount(l.credit, l.currency)}
                              </Text>
                              {l.currency && l.currency !== "JPY" && (
                                <Badge size="xs" color="teal" variant="outline">
                                  {l.currency}
                                </Badge>
                              )}
                            </Group>
                          ))}
                        </Stack>
                      </Table.Td>
                      {showTimestamp && (
                        <Table.Td>
                          <Text size="xs" c="dimmed">
                            {formatTimestamp(entry.created_at)}
                          </Text>
                        </Table.Td>
                      )}
                      <Table.Td>
                        <Group gap={4} wrap="nowrap">
                          {onEdit && (
                            <Tooltip label={t("editLabel")}>
                              <ActionIcon
                                variant="subtle"
                                size="sm"
                                onClick={() => onEdit(entry)}
                              >
                                <IconPencil size={14} />
                              </ActionIcon>
                            </Tooltip>
                          )}
                          <Tooltip label={t("deleteEntry")}>
                            <ActionIcon
                              variant="subtle"
                              color="red"
                              size="sm"
                              onClick={() => onDelete(entry.id)}
                            >
                              <IconTrash size={14} />
                            </ActionIcon>
                          </Tooltip>
                        </Group>
                      </Table.Td>
                    </Table.Tr>
                  );
                })
              )}
            </Table.Tbody>
          </Table>
        </ScrollArea>
      )}
    </Stack>
  );
}
