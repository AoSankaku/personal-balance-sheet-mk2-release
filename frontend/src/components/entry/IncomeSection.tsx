import {
  ActionIcon,
  Badge,
  Divider,
  Group,
  NumberInput,
  Paper,
  Select,
  Stack,
  Switch,
  Table,
  Text,
} from "@mantine/core";
import type { UseFormReturnType } from "@mantine/form";
import { IconAlertTriangle, IconRefresh } from "@tabler/icons-react";
import type { BudgetCategory } from "@balance-sheet/shared";
import { useLang } from "../../i18n";
import { useAppData } from "../../context/AppDataContext";
import { renderAccountOption, type AccountOption } from "../../lib/accountSelect";
import {
  formatBudgetDistributionRatio,
  type AmountDistributionSummary,
} from "../../lib/simpleEntryUtils";
import {
  type HouseholdForm,
  type StepPreview,
} from "../SimpleEntryForm";

type SelectData = AccountOption | { group: string; items: AccountOption[] };

interface IncomeDist {
  budget_category_id: number;
  name: string;
  amount: number;
}

interface Props {
  form: UseFormReturnType<HouseholdForm>;
  isMobile: boolean;
  incomeOptions: AccountOption[];
  incomeDepositOptions: SelectData[];
  activeFilterOptions: SelectData[];
  budgetCategories: BudgetCategory[];
  isRegularIncome: boolean;
  setIsRegularIncome: (v: boolean) => void;
  selectedFilterId: string | null;
  setSelectedFilterId: (v: string | null) => void;
  setIncomeDist: (v: IncomeDist[]) => void;
  displayIncomeDist: IncomeDist[];
  filterStepPreview: StepPreview[];
  incomeDistributionSummary: AmountDistributionSummary;
  totalIncomeDist: number;
  showManualIncomeDist: boolean;
  handleIncomeDistChange: (catId: number, newAmt: number) => void;
  handleIncomeTypeChange: (v: string | null) => void;
}

export function IncomeSection({
  form,
  isMobile,
  incomeOptions,
  incomeDepositOptions,
  activeFilterOptions,
  budgetCategories,
  isRegularIncome,
  setIsRegularIncome,
  selectedFilterId,
  setSelectedFilterId,
  setIncomeDist,
  displayIncomeDist,
  filterStepPreview,
  incomeDistributionSummary,
  totalIncomeDist,
  showManualIncomeDist,
  handleIncomeDistChange,
  handleIncomeTypeChange,
}: Props) {
  const { t } = useLang();
  const { displayCurrencySymbol: currencySymbol } = useAppData();
  const incomeTotalRatioLabel = `${formatBudgetDistributionRatio(
    incomeDistributionSummary.displayRatio,
  )}%`;

  return (
    <>
      <Select
        label={t("incomeTypeLabel")}
        placeholder={t("selectAccount")}
        data={incomeOptions}
        searchable={!isMobile}
        required
        value={
          form.values.incomeTypeId != null
            ? String(form.values.incomeTypeId)
            : null
        }
        onChange={handleIncomeTypeChange}
        error={form.errors.incomeTypeId}
        renderOption={renderAccountOption as any}
      />
      <Select
        label={t("depositedToLabel")}
        placeholder={t("selectAccount")}
        data={incomeDepositOptions}
        searchable={!isMobile}
        required
        value={
          form.values.incomeDepositedToId != null
            ? String(form.values.incomeDepositedToId)
            : null
        }
        onChange={(v) =>
          form.setFieldValue("incomeDepositedToId", v ? Number(v) : null)
        }
        error={form.errors.incomeDepositedToId}
        renderOption={renderAccountOption as any}
      />
      <NumberInput
        label={t("amountLabel")}
        placeholder="0"
        required
        min={0}
        prefix={currencySymbol}
        thousandSeparator=","
        {...form.getInputProps("amount")}
      />

      {budgetCategories.length > 0 && (
        <Switch
          label={t("applyBudgetFilterLabel")}
          checked={isRegularIncome}
          onChange={(e) => {
            const next = e.currentTarget.checked;
            setIsRegularIncome(next);
            if (!next && selectedFilterId) {
              setSelectedFilterId(null);
              setIncomeDist([]);
            }
          }}
        />
      )}

      {isRegularIncome && activeFilterOptions.length > 0 && (
        <Select
          label={t("budgetFilterTitle")}
          placeholder={t("filterSelectPlaceholder")}
          data={activeFilterOptions}
          value={selectedFilterId}
          onChange={(v) => {
            if (!v) setIncomeDist([]);
            setSelectedFilterId(v);
          }}
          clearable
        />
      )}

      {isRegularIncome && filterStepPreview.length > 0 && (
        <Paper
          withBorder
          p="xs"
          radius="sm"
          bg="var(--mantine-color-default-hover)"
        >
          <Stack gap={6}>
            <Text size="xs" fw={600} c="dimmed">
              {t("budgetFilterDefaultLabel")}
            </Text>
            {filterStepPreview.map((step, i) => {
              const stepTypeLabel =
                step.step_type === "fixed"
                  ? t("filterStepFixed")
                  : step.step_type === "capped"
                    ? t("filterStepCapped")
                    : t("filterStepRemainder");
              return (
                <Stack key={step.step_order} gap={2}>
                  {i > 0 && <Divider />}
                  <Group gap={4}>
                    <Text size="xs" c="dimmed">
                      {step.step_order}.
                    </Text>
                    <Text size="xs" fw={600}>
                      {stepTypeLabel}
                    </Text>
                    <Text size="xs" c="dimmed">
                      (¥{step.inputAmount.toLocaleString()} →)
                    </Text>
                  </Group>
                  <Table horizontalSpacing={4} verticalSpacing={1} fz="xs">
                    <Table.Tbody>
                      {step.allocations.map((alloc) => (
                        <Table.Tr key={alloc.budget_category_id}>
                          <Table.Td pl={12}>{alloc.name}</Table.Td>
                          {alloc.ratio != null && (
                            <Table.Td ta="right" c="dimmed" w={44}>
                              {Math.round(alloc.ratio * 100)}%
                            </Table.Td>
                          )}
                          <Table.Td
                            ta="right"
                            className="currency-cell"
                            w={110}
                            colSpan={alloc.ratio == null ? 2 : 1}
                          >
                            ¥{alloc.amount.toLocaleString()}
                          </Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                  <Text size="xs" c="dimmed" ta="right">
                    → ¥{step.outputAmount.toLocaleString()}{" "}
                    {t("filterStepRemaining")}
                  </Text>
                </Stack>
              );
            })}
          </Stack>
        </Paper>
      )}

      {budgetCategories.length > 0 && (
        <Paper withBorder p="xs" radius="sm">
          <Stack gap={4}>
            <Group justify="space-between">
              <Text size="xs" fw={600} c="dimmed">
                {t("budgetDistributionPreview")}
              </Text>
              <Badge
                size="xs"
                variant="light"
                color={
                  incomeDistributionSummary.isOverAllocated
                    ? "red"
                    : incomeDistributionSummary.isUnderAllocated
                      ? "yellow"
                      : "teal"
                }
                leftSection={
                  incomeDistributionSummary.isOverAllocated ||
                  incomeDistributionSummary.isUnderAllocated ? (
                    <IconAlertTriangle size={10} />
                  ) : undefined
                }
              >
                {t("budgetDistributionTotal")}: {incomeTotalRatioLabel}
              </Badge>
            </Group>
            {(() => {
              const defaultAmountMap = filterStepPreview.reduce<
                Record<number, number>
              >((acc, step) => {
                for (const alloc of step.allocations) {
                  acc[alloc.budget_category_id] =
                    (acc[alloc.budget_category_id] ?? 0) + alloc.amount;
                }
                return acc;
              }, {});
              return displayIncomeDist.map((row) => {
                const pct =
                  form.values.amount > 0
                    ? Math.round((row.amount / form.values.amount) * 100)
                    : 0;
                const defaultAmt =
                  defaultAmountMap[row.budget_category_id] ?? 0;
                const isDirty =
                  !showManualIncomeDist && row.amount !== defaultAmt;
                return (
                  <Group key={row.budget_category_id} gap="xs" align="center">
                    <Text size="sm" flex={1}>
                      {row.name}
                    </Text>
                    <Text size="xs" c="dimmed" w={36} ta="right">
                      {pct}%
                    </Text>
                    <NumberInput
                      w={130}
                      size="xs"
                      min={0}
                      prefix={currencySymbol}
                      thousandSeparator=","
                      hideControls={isMobile}
                      value={row.amount}
                      onChange={(v) =>
                        handleIncomeDistChange(
                          row.budget_category_id,
                          Number(v) || 0,
                        )
                      }
                    />
                    {!showManualIncomeDist && (
                      <ActionIcon
                        size="xs"
                        variant="subtle"
                        color="gray"
                        disabled={!isDirty}
                        onClick={() =>
                          handleIncomeDistChange(
                            row.budget_category_id,
                            defaultAmt,
                          )
                        }
                      >
                        <IconRefresh size={12} />
                      </ActionIcon>
                    )}
                  </Group>
                );
              });
            })()}
            <Group
              justify="flex-end"
              pt={4}
              style={{
                borderTop: "1px solid var(--mantine-color-default-border)",
              }}
            >
              <Text size="xs" c="dimmed">
                {t("budgetDistributionTotal")}:
              </Text>
              <Text size="xs" c="dimmed" w={36} ta="right">
                {incomeTotalRatioLabel}
              </Text>
              <Text size="xs" fw={600} w={130} ta="right">
                ¥{totalIncomeDist.toLocaleString()}
              </Text>
            </Group>
          </Stack>
        </Paper>
      )}
    </>
  );
}
