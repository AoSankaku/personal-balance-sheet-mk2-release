import {
  ActionIcon,
  Box,
  Button,
  NumberInput,
  Paper,
  ScrollArea,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
} from "@mantine/core";
import { IconPlus, IconX } from "@tabler/icons-react";
import type { Account, JournalEntry } from "@balance-sheet/shared";
import { useLang } from "../../i18n";
import type { WorksheetRow } from "./ttUtils";

export function signedAccountImpact(entry: JournalEntry, account: Account): number {
  const raw = entry.lines
    .filter((line) => line.account_id === account.id)
    .reduce((sum, line) => sum + line.debit - line.credit, 0);
  const isDebitNormal = account.type === "asset" || account.type === "expense";
  return isDebitNormal ? raw : -raw;
}

export function WorksheetEditor({
  rows,
  onChange,
  accountOptions,
}: {
  rows: WorksheetRow[];
  onChange: (rows: WorksheetRow[]) => void;
  accountOptions: { value: string; label: string }[];
}) {
  const { t } = useLang();

  function addRow() {
    onChange([
      ...rows,
      { id: crypto.randomUUID(), account_id: null, amount: "", note: "" },
    ]);
  }

  function removeRow(id: string) {
    onChange(rows.filter((r) => r.id !== id));
  }

  function updateRow(id: string, patch: Partial<WorksheetRow>) {
    onChange(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  return (
    <Paper withBorder p="md" radius="md">
      <Stack gap="sm">
        <Box>
          <Text fw={600} size="sm">
            {t("ttWorksheetTitle")}
          </Text>
          <Text size="xs" c="dimmed">
            {t("ttWorksheetNote")}
          </Text>
        </Box>

        {rows.length > 0 && (
          <ScrollArea type="auto">
            <Table fz="sm" withRowBorders miw={560}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th style={{ minWidth: 160 }}>
                    {t("ttWorksheetAccount")}
                  </Table.Th>
                  <Table.Th className="currency-cell" style={{ minWidth: 140 }}>
                    {t("ttWorksheetAmount")}
                  </Table.Th>
                  <Table.Th style={{ minWidth: 160 }}>
                    {t("ttWorksheetNote2")}
                  </Table.Th>
                  <Table.Th style={{ width: 40 }} />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {rows.map((row) => (
                  <Table.Tr key={row.id}>
                    <Table.Td className="currency-cell">
                      <Select
                        size="xs"
                        data={accountOptions}
                        value={
                          row.account_id !== null
                            ? String(row.account_id)
                            : null
                        }
                        onChange={(v) =>
                          updateRow(row.id, {
                            account_id: v !== null ? Number(v) : null,
                          })
                        }
                        placeholder={t("ttWorksheetAccount")}
                        clearable
                      />
                    </Table.Td>
                    <Table.Td>
                      <NumberInput
                        size="xs"
                        value={row.amount}
                        onChange={(v) => updateRow(row.id, { amount: v })}
                        prefix="¥"
                        thousandSeparator=","
                        hideControls
                        w={140}
                        style={{ marginLeft: "auto" }}
                      />
                    </Table.Td>
                    <Table.Td>
                      <TextInput
                        size="xs"
                        value={row.note ?? ""}
                        onChange={(e) =>
                          updateRow(row.id, { note: e.currentTarget.value })
                        }
                        placeholder="-"
                      />
                    </Table.Td>
                    <Table.Td>
                      <ActionIcon
                        color="red"
                        variant="subtle"
                        size="sm"
                        onClick={() => removeRow(row.id)}
                      >
                        <IconX size={14} />
                      </ActionIcon>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea>
        )}

        <Box>
          <Button
            size="xs"
            variant="light"
            leftSection={<IconPlus size={14} />}
            onClick={addRow}
          >
            {t("ttWorksheetAddRow")}
          </Button>
        </Box>
      </Stack>
    </Paper>
  );
}
