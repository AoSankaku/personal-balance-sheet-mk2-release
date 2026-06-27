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
import { toIntlLocale, type TranslationKey, useLang } from "../i18n";
import { formatCurrency } from "../lib/numberFormat";

interface Props {
  entries: JournalEntry[];
  accounts: Account[];
  onDelete?: (id: number) => void;
  onEdit?: (entry: JournalEntry) => void;
  view?: "simple" | "double";
  showTimestamp?: boolean;
  displayCurrency?: string;
  displayCurrencySymbol?: string;
  readOnly?: boolean;
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

type JournalLine = JournalEntry["lines"][number];
type DisplayTone = "positive" | "negative" | "neutral";
interface NarrativeToken {
  text: string;
  tone?: DisplayTone;
  nowrap?: boolean;
  emphasis?: boolean;
  dimmed?: boolean;
}
interface SimpleNarrative {
  key: string;
  templateKey: TranslationKey;
  values: Record<string, string | NarrativeToken>;
}

function lineAmount(line: JournalLine) {
  return line.debit > 0 ? line.debit : line.credit;
}

function isIncreasingLine(line: JournalLine, type?: Account["type"]) {
  if (!type) return false;
  if (type === "asset" || type === "expense") return line.debit > 0;
  return line.credit > 0;
}

function accountTone(line: JournalLine, type?: Account["type"]): DisplayTone {
  return isSimpleDisplayPositive(line, type) ? "positive" : "negative";
}

function isSimpleDisplayPositive(line: JournalLine, type?: Account["type"]) {
  if (!type) return false;
  if (type === "expense") return !isIncreasingLine(line, type);
  return isIncreasingLine(line, type);
}

function signedAmountLabel(
  amount: string,
  tone: DisplayTone,
  showSign = true,
) {
  if (!showSign || tone === "neutral") return amount;
  return `${tone === "positive" ? "+" : "-"}${amount}`;
}

function lineId(line: JournalLine, index: number) {
  return line.id ?? `${line.account_id}-${index}`;
}

export function JournalTable({
  entries,
  accounts,
  onDelete,
  onEdit,
  view = "double",
  showTimestamp = false,
  displayCurrency,
  displayCurrencySymbol,
  readOnly = false,
}: Props) {
  const { t, locale } = useLang();
  const isMobile = useMediaQuery("(max-width: 48em)");

  function formatTimestamp(ts: string) {
    const d = new Date(ts.replace(" ", "T"));
    if (isNaN(d.getTime())) return ts;
    return new Intl.DateTimeFormat(toIntlLocale(locale), {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(d);
  }
  const accountTypeMap = new Map(accounts.map((a) => [a.id, a.type]));
  const formatAmount = (amount: number, currency?: string) => {
    const normalized = normalizeCurrency(currency);
    const symbol =
      displayCurrency &&
      normalizeCurrency(displayCurrency) === normalized
        ? displayCurrencySymbol
        : undefined;
    return formatCurrency(amount, locale, normalized, symbol);
  };
  const describeAmount = (line: JournalLine, tone: DisplayTone) => ({
    text: signedAmountLabel(formatAmount(lineAmount(line), line.currency), tone),
    tone,
    nowrap: true,
  });
  const describeAccount = (line: JournalLine, tone: DisplayTone) => ({
    text: line.account_name,
    tone,
  });

  function buildLineNarrative(line: JournalLine, index: number): SimpleNarrative {
    const type = accountTypeMap.get(line.account_id);
    const tone = accountTone(line, type);
    const amount = describeAmount(line, tone);
    const account = describeAccount(line, tone);
    const values = { account, amount };

    if (type === "expense") {
      if (isIncreasingLine(line, type)) {
        return {
          key: `expense-increase-${lineId(line, index)}`,
          templateKey: "ledgerSimpleExpenseIncrease",
          values,
        };
      }
      return {
        key: `expense-decrease-${lineId(line, index)}`,
        templateKey: "ledgerSimpleExpenseIncomeDecrease",
        values,
      };
    }

    if (type === "income") {
      if (isIncreasingLine(line, type)) {
        return {
          key: `income-increase-${lineId(line, index)}`,
          templateKey: "ledgerSimpleIncomeIncrease",
          values,
        };
      }
      return {
        key: `income-decrease-${lineId(line, index)}`,
        templateKey: "ledgerSimpleExpenseIncomeDecrease",
        values,
      };
    }

    if (type === "asset") {
      return {
        key: `asset-${lineId(line, index)}`,
        templateKey: isIncreasingLine(line, type)
          ? "ledgerSimpleAssetIncrease"
          : "ledgerSimpleAssetDecrease",
        values,
      };
    }

    if (type === "liability") {
      return {
        key: `liability-${lineId(line, index)}`,
        templateKey: isIncreasingLine(line, type)
          ? "ledgerSimpleLiabilityIncrease"
          : "ledgerSimpleLiabilityDecrease",
        values,
      };
    }

    if (type === "equity") {
      return {
        key: `equity-${lineId(line, index)}`,
        templateKey: "ledgerSimpleEquitySet",
        values,
      };
    }

    return {
      key: `unknown-${lineId(line, index)}`,
      templateKey: "ledgerSimpleFallback",
      values,
    };
  }

  function buildTransferNarrative(
    entry: JournalEntry,
    debitLine: JournalLine,
    creditLine: JournalLine,
  ): SimpleNarrative | null {
    const debitType = accountTypeMap.get(debitLine.account_id);
    const creditType = accountTypeMap.get(creditLine.account_id);
    if (!debitType || debitType !== creditType) return null;
    if (
      normalizeCurrency(debitLine.currency) !==
      normalizeCurrency(creditLine.currency)
    ) {
      return null;
    }
    if (Math.abs(debitLine.debit - creditLine.credit) > 0.000001) return null;

    const debitIncreases = isIncreasingLine(debitLine, debitType);
    const decreasingLine = debitIncreases ? creditLine : debitLine;
    const increasingLine = debitIncreases ? debitLine : creditLine;
    return {
      key: `transfer-${entry.id}`,
      templateKey: "ledgerSimpleTransfer",
      values: {
        fromAccount: describeAccount(decreasingLine, "negative"),
        toAccount: describeAccount(increasingLine, "positive"),
        amount: {
          text: formatAmount(lineAmount(debitLine), debitLine.currency),
          tone: "neutral",
          nowrap: true,
        },
      },
    };
  }

  function buildSimpleNarratives(entry: JournalEntry) {
    const selectedLines = entry.lines.filter(
      (line) =>
        (line.debit > 0 || line.credit > 0) &&
        lineMatchesCurrency(line, displayCurrency),
    );
    const debitLines = selectedLines.filter((line) => line.debit > 0);
    const creditLines = selectedLines.filter((line) => line.credit > 0);

    if (debitLines.length === 1 && creditLines.length === 1) {
      const transfer = buildTransferNarrative(
        entry,
        debitLines[0],
        creditLines[0],
      );
      if (transfer) return { narratives: [transfer], isComplex: false };

      const primaryLine =
        selectedLines.find((line) => {
          const type = accountTypeMap.get(line.account_id);
          return type === "expense" || type === "income";
        }) ??
        selectedLines.find((line) => {
          const type = accountTypeMap.get(line.account_id);
          return type === "liability" || type === "equity";
        }) ??
        selectedLines.find(
          (l) => accountTypeMap.get(l.account_id) === "asset",
        ) ??
        selectedLines[0];

      return {
        narratives: [buildLineNarrative(primaryLine, 0)],
        isComplex: false,
      };
    }

    return {
      narratives: selectedLines.map(buildLineNarrative),
      isComplex: selectedLines.length > 2,
    };
  }

  function renderNarrativeToken(
    token: NarrativeToken,
    key?: string,
  ) {
    const tone = token.tone;
    return (
      <Text
        key={key}
        component="span"
        inherit
        fw={token.emphasis === false ? undefined : 700}
        c={
          token.dimmed
            ? "dimmed"
            : tone === "positive"
            ? "green"
            : tone === "negative"
              ? "red"
              : undefined
        }
        style={{
          marginInline: "0.25em",
          overflowWrap: token.nowrap ? undefined : "anywhere",
          whiteSpace: token.nowrap ? "nowrap" : undefined,
        }}
      >
        {token.text}
      </Text>
    );
  }

  function renderTemplate(
    template: string,
    values: Record<string, string | NarrativeToken>,
    keyPrefix: string,
  ) {
    const parts = template.split(/(\{[a-zA-Z0-9_]+\})/g);
    return parts.map((part, index) => {
      const match = /^\{([a-zA-Z0-9_]+)\}$/.exec(part);
      if (!match) return <span key={`${keyPrefix}-text-${index}`}>{part}</span>;

      const value = values[match[1]];
      if (value == null) return null;
      if (typeof value === "string") {
        return <span key={`${keyPrefix}-${match[1]}-${index}`}>{value}</span>;
      }
      return renderNarrativeToken(value, `${keyPrefix}-${match[1]}-${index}`);
    });
  }

  function renderNarrative(entry: JournalEntry, narrative: SimpleNarrative) {
    const description: NarrativeToken = {
      text: entry.description,
      emphasis: false,
      dimmed: true,
    };
    return (
      <Text
        key={narrative.key}
        size="sm"
        style={{ whiteSpace: "normal", overflowWrap: "anywhere" }}
      >
        {renderTemplate(
          t(narrative.templateKey),
          { description, ...narrative.values },
          narrative.key,
        )}
      </Text>
    );
  }

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
            style={{ minWidth: "min(200vw, 640px)" }}
          >
            <Table.Thead>
              <Table.Tr>
                <Table.Th style={{ whiteSpace: "nowrap", width: "1%" }}>
                  {t("thDate")}
                </Table.Th>
                <Table.Th>{t("thDescription")}</Table.Th>
                {showTimestamp && (
                  <Table.Th style={{ width: 140 }}>{t("thCreatedAt")}</Table.Th>
                )}
                <Table.Th style={{ width: 80 }} />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {entries.length === 0 ? (
                <Table.Tr>
                  <Table.Td colSpan={showTimestamp ? 4 : 3}>
                    <Text c="dimmed" ta="center" size="sm" py="xs">
                      {t("noTransactionsYet")}
                    </Text>
                  </Table.Td>
                </Table.Tr>
              ) : (
                entries.map((entry) => {
                  const { narratives, isComplex } = buildSimpleNarratives(entry);
                  return (
                    <Table.Tr key={entry.id}>
                      <Table.Td style={{ whiteSpace: "nowrap" }}>
                        <Text size="sm">{entry.date}</Text>
                      </Table.Td>
                      <Table.Td>
                        <Stack gap={4}>
                          {isComplex && (
                            <Badge
                              size="xs"
                              color="violet"
                              variant="light"
                              w="fit-content"
                            >
                              {t("ledgerSimpleSameEntryBadge")}
                            </Badge>
                          )}
                          {narratives.length > 0 ? (
                            narratives.map((narrative) =>
                              renderNarrative(entry, narrative),
                            )
                          ) : (
                            <Text size="sm" fw={500}>
                              {entry.description}
                            </Text>
                          )}
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
                          {!readOnly && onEdit && (
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
                          {!readOnly && onDelete && (
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
                          )}
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
                          {!readOnly && onEdit && (
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
                          {!readOnly && onDelete && (
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
                          )}
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
