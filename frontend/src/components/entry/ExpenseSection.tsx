import {
  Badge,
  Collapse,
  Group,
  NumberInput,
  Paper,
  Select,
  SegmentedControl,
  Stack,
  Switch,
  Text,
  UnstyledButton,
} from "@mantine/core";
import type { UseFormReturnType } from "@mantine/form";
import { IconAlertTriangle } from "@tabler/icons-react";
import type { Account, BudgetSettings } from "@balance-sheet/shared";
import { useLang } from "../../i18n";
import { useAppData } from "../../context/AppDataContext";
import { renderAccountOption, type AccountOption } from "../../lib/accountSelect";
import { computeBudgetDistributionAmounts } from "../../lib/simpleEntryUtils";
import {
  type BudgetDistributionItem,
  type HouseholdForm,
} from "../SimpleEntryForm";

type SelectData = AccountOption | { group: string; items: AccountOption[] };

interface Props {
  form: UseFormReturnType<HouseholdForm>;
  isMobile: boolean;
  expenseOptions: SelectData[];
  expenseOnlyOptions: AccountOption[];
  paidFromOptions: SelectData[];
  assetOptions: AccountOption[];
  depreciableAssetOptions: AccountOption[];
  selectedPaymentAccount: Account | undefined;
  budgetSettings: BudgetSettings | null;
  budgetDist: BudgetDistributionItem[];
  showZeroCategories: boolean;
  setShowZeroCategories: React.Dispatch<React.SetStateAction<boolean>>;
  totalBudgetRatio: number;
  businessRatio: number;
  businessAmount: number;
  personalAmount: number;
  personalRatio: number;
  depreciationEnabled: boolean;
  setDepreciationEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  depreciationAssetAccountId: number | null;
  setDepreciationAssetAccountId: React.Dispatch<
    React.SetStateAction<number | null>
  >;
  depreciationExpenseAccountId: number | null;
  setDepreciationExpenseAccountId: React.Dispatch<
    React.SetStateAction<number | null>
  >;
  depreciationInputMode: "months" | "monthly_amount";
  setDepreciationInputMode: React.Dispatch<
    React.SetStateAction<"months" | "monthly_amount">
  >;
  depreciationMonths: number | string;
  setDepreciationMonths: React.Dispatch<React.SetStateAction<number | string>>;
  depreciationMonthlyAmount: number | string;
  setDepreciationMonthlyAmount: React.Dispatch<
    React.SetStateAction<number | string>
  >;
  onDepreciationSubmit?: ((...args: never[]) => unknown) | null;
  handleExpenseAccountChange: (v: string | null) => void;
  handleRatioChange: (
    catId: number,
    newRatio: number,
    baseAmount: number,
  ) => void;
  handleBudgetAmountChange: (
    catId: number,
    newAmount: number,
    baseAmount: number,
  ) => void;
}

export function ExpenseSection({
  form,
  isMobile,
  expenseOptions,
  expenseOnlyOptions,
  paidFromOptions,
  assetOptions,
  depreciableAssetOptions,
  selectedPaymentAccount,
  budgetSettings,
  budgetDist,
  showZeroCategories,
  setShowZeroCategories,
  totalBudgetRatio,
  businessRatio,
  businessAmount,
  personalAmount,
  personalRatio,
  depreciationEnabled,
  setDepreciationEnabled,
  depreciationAssetAccountId,
  setDepreciationAssetAccountId,
  depreciationExpenseAccountId,
  setDepreciationExpenseAccountId,
  depreciationInputMode,
  setDepreciationInputMode,
  depreciationMonths,
  setDepreciationMonths,
  depreciationMonthlyAmount,
  setDepreciationMonthlyAmount,
  onDepreciationSubmit,
  handleExpenseAccountChange,
  handleRatioChange,
  handleBudgetAmountChange,
}: Props) {
  const { t } = useLang();
  const { displayCurrencySymbol: currencySymbol } = useAppData();
  const entryType = form.values.entryType;

  return (
    <>
      {budgetSettings?.is_business_owner && (
        <Switch
          label={t("transactionTypeBusinessAdvance")}
          checked={entryType === "business_advance"}
          onChange={(e) =>
            form.setFieldValue(
              "entryType",
              e.currentTarget.checked ? "business_advance" : "expense",
            )
          }
        />
      )}

      {depreciableAssetOptions.length > 0 && onDepreciationSubmit && (
        <Switch
          label={t("depreciationLabel")}
          checked={depreciationEnabled}
          onChange={(e) => setDepreciationEnabled(e.currentTarget.checked)}
        />
      )}

      {!depreciationEnabled ? (
        <Select
          label={t("categoryLabel")}
          placeholder={t("selectAccount")}
          data={expenseOptions}
          searchable={!isMobile}
          required
          value={
            form.values.expenseCategoryId != null
              ? String(form.values.expenseCategoryId)
              : null
          }
          onChange={handleExpenseAccountChange}
          error={form.errors.expenseCategoryId}
          renderOption={renderAccountOption as any}
        />
      ) : (
        <>
          <Select
            label={t("depreciationAssetAccountLabel")}
            placeholder={t("selectAccount")}
            data={depreciableAssetOptions}
            required
            value={
              depreciationAssetAccountId != null
                ? String(depreciationAssetAccountId)
                : null
            }
            onChange={(v) =>
              setDepreciationAssetAccountId(v ? Number(v) : null)
            }
            renderOption={renderAccountOption as any}
          />
          <Select
            label={t("depreciationExpenseAccountLabel")}
            placeholder={t("selectAccount")}
            data={expenseOnlyOptions}
            required
            value={
              depreciationExpenseAccountId != null
                ? String(depreciationExpenseAccountId)
                : null
            }
            onChange={(v) =>
              setDepreciationExpenseAccountId(v ? Number(v) : null)
            }
            renderOption={renderAccountOption as any}
          />
          <SegmentedControl
            size="xs"
            data={[
              { value: "months", label: t("depreciationByMonths") },
              {
                value: "monthly_amount",
                label: t("depreciationByMonthlyAmount"),
              },
            ]}
            value={depreciationInputMode}
            onChange={(v) =>
              setDepreciationInputMode(v as "months" | "monthly_amount")
            }
          />
          {depreciationInputMode === "months" ? (
            <NumberInput
              label={t("depreciationMonthsLabel")}
              min={1}
              max={480}
              allowDecimal={false}
              value={depreciationMonths}
              onChange={(v) => setDepreciationMonths(v)}
            />
          ) : (
            <NumberInput
              label={t("depreciationMonthlyAmountLabel")}
              min={1}
              prefix={currencySymbol}
              thousandSeparator=","
              value={depreciationMonthlyAmount}
              onChange={(v) => setDepreciationMonthlyAmount(v)}
            />
          )}
          {form.values.amount > 0 && (
            <Text size="xs" c="dimmed">
              {(() => {
                const total =
                  entryType === "business_advance"
                    ? personalAmount
                    : form.values.amount;
                const months =
                  depreciationInputMode === "months"
                    ? Number(depreciationMonths) || 1
                    : Math.max(
                        1,
                        Math.ceil(
                          total / (Number(depreciationMonthlyAmount) || 1),
                        ),
                      );
                const base = Math.floor(total / months);
                return `${t("depreciationPreview")}: ¥${base.toLocaleString()} × ${months}${t("depreciationMonthUnit")} = ¥${total.toLocaleString()}`;
              })()}
            </Text>
          )}
        </>
      )}

      <NumberInput
        label={t("amountLabel")}
        placeholder="0"
        required
        min={0}
        prefix={currencySymbol}
        thousandSeparator=","
        {...form.getInputProps("amount")}
      />

      {entryType === "business_advance" && (
        <>
          <Paper withBorder p="xs" radius="sm">
            <Stack gap={4}>
              <Group justify="space-between">
                <div>
                  <Text size="xs" fw={600} c="dimmed">
                    {t("businessRatioLabel")}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {t("businessRatioDesc")}
                  </Text>
                </div>
                <Badge size="xs" variant="light" color="teal">
                  {t("budgetDistributionTotal")}: 100%
                </Badge>
              </Group>

              <Group gap="xs" align="center">
                <Text size="sm" flex={1}>
                  {t("businessAdvanceSplitBusiness")}
                </Text>
                <NumberInput
                  w={80}
                  size="xs"
                  min={0}
                  max={100}
                  suffix="%"
                  hideControls={isMobile}
                  value={businessRatio}
                  disabled={form.values.amount <= 0}
                  onChange={(v) =>
                    form.setFieldValue(
                      "businessRatio",
                      Math.min(100, Math.max(0, Number(v) || 0)),
                    )
                  }
                  styles={(theme) => ({
                    input: { color: theme.colors.teal[6], fontWeight: 600 },
                  })}
                />
                <NumberInput
                  w={110}
                  size="xs"
                  min={0}
                  max={form.values.amount}
                  prefix={currencySymbol}
                  thousandSeparator=","
                  hideControls
                  value={businessAmount}
                  disabled={form.values.amount <= 0}
                  onChange={(v) => {
                    const total = form.values.amount;
                    const pct =
                      total > 0
                        ? Math.min(
                            100,
                            Math.max(0, Math.round((Number(v) / total) * 100)),
                          )
                        : 0;
                    form.setFieldValue("businessRatio", pct);
                  }}
                  styles={(theme) => ({
                    input: { color: theme.colors.teal[6], fontWeight: 600 },
                  })}
                />
              </Group>

              <Group
                gap="xs"
                align="center"
                pt={4}
                style={{
                  borderTop: "1px solid var(--mantine-color-default-border)",
                }}
              >
                <Text size="sm" flex={1} c="dimmed">
                  {t("businessAdvanceSplitPersonal")}
                </Text>
                <Text size="xs" c="dimmed" w={80} ta="right">
                  {personalRatio}%
                </Text>
                <Text size="xs" fw={600} c="dimmed" w={110} ta="right">
                  ¥{personalAmount.toLocaleString()}
                </Text>
              </Group>
            </Stack>
          </Paper>
          <Select
            label={t("businessAdvanceAccountLabel")}
            placeholder={t("selectAccount")}
            data={assetOptions}
            searchable={!isMobile}
            required
            value={
              form.values.businessAdvanceAccountId != null
                ? String(form.values.businessAdvanceAccountId)
                : null
            }
            onChange={(v) =>
              form.setFieldValue(
                "businessAdvanceAccountId",
                v ? Number(v) : null,
              )
            }
            error={form.errors.businessAdvanceAccountId}
            renderOption={renderAccountOption as any}
          />
        </>
      )}

      {!depreciationEnabled &&
        budgetDist.length > 0 &&
        (() => {
          const budgetBase =
            entryType === "business_advance"
              ? personalAmount
              : form.values.amount;
          const computedBudgetAmounts = computeBudgetDistributionAmounts(
            budgetBase,
            budgetDist,
          );
          const primaryDist = budgetDist.filter((d) => !d.isDefault);
          const zeroDist = budgetDist.filter((d) => d.isDefault);
          const renderRow = (dist: BudgetDistributionItem) => (
            <Group key={dist.budget_category_id} gap="xs" align="center">
              <Text size="sm" flex={1}>
                {dist.name}
              </Text>
              <NumberInput
                w={80}
                size="xs"
                min={0}
                max={100}
                suffix="%"
                value={dist.ratio}
                onChange={(v) =>
                  handleRatioChange(
                    dist.budget_category_id,
                    Number(v) || 0,
                    budgetBase,
                  )
                }
              />
              <NumberInput
                w={90}
                size="xs"
                min={0}
                prefix={currencySymbol}
                hideControls
                thousandSeparator=","
                value={
                  dist.amount ??
                  computedBudgetAmounts.get(dist.budget_category_id) ??
                  0
                }
                onChange={(v) => {
                  const num = Number(v) || 0;
                  handleBudgetAmountChange(
                    dist.budget_category_id,
                    num,
                    budgetBase,
                  );
                }}
              />
            </Group>
          );
          return (
            <Stack gap={4}>
              <Group justify="space-between">
                <Text size="xs" c="dimmed">
                  {t("budgetAllocationDisplay")}
                </Text>
                <Badge
                  size="xs"
                  variant="light"
                  color={
                    totalBudgetRatio > 100
                      ? "red"
                      : totalBudgetRatio > 0 && totalBudgetRatio < 100
                        ? "yellow"
                        : "teal"
                  }
                  leftSection={
                    totalBudgetRatio > 0 && totalBudgetRatio < 100 ? (
                      <IconAlertTriangle size={10} />
                    ) : undefined
                  }
                >
                  {t("budgetDistributionTotal")}: {totalBudgetRatio}%
                </Badge>
              </Group>
              {primaryDist.map(renderRow)}
              {zeroDist.length > 0 && (
                <>
                  <UnstyledButton
                    onClick={() => setShowZeroCategories((v) => !v)}
                  >
                    <Text size="xs" c="dimmed">
                      {showZeroCategories ? "▼" : "▶"}{" "}
                      {t("budgetDistOtherCategories")} ({zeroDist.length})
                    </Text>
                  </UnstyledButton>
                  <Collapse in={showZeroCategories}>
                    <Stack gap={4}>{zeroDist.map(renderRow)}</Stack>
                  </Collapse>
                </>
              )}
            </Stack>
          );
        })()}

      <Select
        label={t("paidFromLabel")}
        placeholder={t("selectAccount")}
        data={paidFromOptions}
        searchable={!isMobile}
        required
        value={
          form.values.expensePaidFromId != null
            ? String(form.values.expensePaidFromId)
            : null
        }
        onChange={(v) => {
          form.setFieldValue("expensePaidFromId", v ? Number(v) : null);
          form.setFieldValue("creditCardStatementOffsetMonths", 0);
        }}
        error={form.errors.expensePaidFromId}
        renderOption={renderAccountOption as any}
      />
      {selectedPaymentAccount?.category === "credit_card" && (
        <NumberInput
          label={t("creditCardStatementOffsetLabel")}
          description={t("creditCardStatementOffsetHint")}
          min={0}
          max={12}
          allowDecimal={false}
          value={form.values.creditCardStatementOffsetMonths}
          onChange={(v) =>
            form.setFieldValue(
              "creditCardStatementOffsetMonths",
              Number(v) || 0,
            )
          }
        />
      )}
    </>
  );
}
