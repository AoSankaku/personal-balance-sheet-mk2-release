import { Alert, Checkbox, Radio, Select, Stack, Text } from "@mantine/core";
import { IconAlertTriangle, IconInfoCircle } from "@tabler/icons-react";
import type {
  AccountBudgetRatio,
  DepreciationBudgetMethod,
  DepreciationBudgetSourceAllocation,
  DepreciationBudgetSettings,
} from "@balance-sheet/shared";
import {
  resolveDepreciationMonthlySourceAllocations,
} from "@balance-sheet/shared";
import { useMemo } from "react";
import { useAppData } from "../context/AppDataContext";
import { useLang } from "../i18n";
import { formatCurrency } from "../lib/numberFormat";
import {
  buildDepreciationMonthlySourceDefaults,
  getDepreciationMonthlySourceAllocations,
} from "../lib/depreciationMonthlySources";
import {
  DEPRECIATION_BUDGET_METHOD_ORDER,
  getDepreciationBudgetFormErrors,
  wouldOverdrawDepreciationPurchaseCategory,
} from "../lib/depreciationBudgetForm";
import { DepreciationMonthlySourceEditor } from "./DepreciationMonthlySourceEditor";

interface Props {
  value: DepreciationBudgetSettings | null;
  onChange: (value: DepreciationBudgetSettings | null) => void;
  purchaseAmount: number;
  /** Repair previews supply the historical post-purchase balance; null means not yet known. */
  purchaseBalanceAfter?: number | null;
  currency?: string;
  decimalPlaces?: number;
  representativeMonthlyAmount?: number;
  expenseAccountName?: string;
  accountBudgetRatios?: AccountBudgetRatio[];
  disabled?: boolean;
}

export function DepreciationBudgetFields({
  value,
  onChange,
  purchaseAmount,
  purchaseBalanceAfter,
  currency,
  decimalPlaces = currency === "JPY" || currency === "KRW" ? 0 : 2,
  representativeMonthlyAmount = 0,
  expenseAccountName,
  accountBudgetRatios = [],
  disabled = false,
}: Props) {
  const { t, locale } = useLang();
  const { budgetCategories, budgetSummary, displayCurrency } = useAppData();
  const monthlySourceDefaults = useMemo(
    () => buildDepreciationMonthlySourceDefaults(budgetCategories, accountBudgetRatios),
    [accountBudgetRatios, budgetCategories],
  );
  const categories = budgetCategories
    .filter((category) => !category.is_archived)
    .map((category) => ({
      value: String(category.id),
      label: category.name,
    }));
  const purchaseCategory = budgetSummary?.categories.find(
    (category) => category.category.id === value?.purchase_category_id,
  );
  const currentMonthlySourceAllocations = getDepreciationMonthlySourceAllocations(
    value,
    budgetCategories,
    accountBudgetRatios,
  );
  const predictedPurchaseBalance = purchaseBalanceAfter === undefined
    ? purchaseCategory == null ? null : purchaseCategory.available - purchaseAmount
    : purchaseBalanceAfter;
  const assignedPurchaseWouldBeNegative =
    value?.method === "assigned" &&
    purchaseCategory != null &&
    predictedPurchaseBalance != null &&
    wouldOverdrawDepreciationPurchaseCategory(predictedPurchaseBalance, 0);
  const errors = getDepreciationBudgetFormErrors({
    method: value?.method,
    purchaseCategoryId: value?.purchase_category_id,
    monthlySourceCategoryId: value?.monthly_source_category_id,
    monthlySourceAllocations: currentMonthlySourceAllocations,
    confirmUnallocated: value?.confirm_unallocated,
    confirmMonthlyUnallocated: value?.confirm_monthly_unallocated,
  });

  function update(patch: Partial<DepreciationBudgetSettings>) {
    if (!value) return;
    onChange({ ...value, ...patch });
  }

  function changeMethod(methodValue: string) {
    const method = methodValue as DepreciationBudgetMethod;
    const sourceAllocations = value?.monthly_source_allocations !== undefined ||
        value?.monthly_source_category_id != null
      ? resolveDepreciationMonthlySourceAllocations(value)
      : monthlySourceDefaults;
    onChange({
      ...(value ?? {}),
      method,
      purchase_category_id:
        method === "assigned" ? value?.purchase_category_id ?? null : null,
      monthly_source_allocations: sourceAllocations,
      monthly_source_category_id: sourceAllocations.find(
        (allocation) => allocation.budget_category_id != null && allocation.ratio > 0,
      )?.budget_category_id ?? null,
      confirm_unallocated: false,
      confirm_monthly_unallocated: false,
    });
  }

  function changeMonthlySources(allocations: DepreciationBudgetSourceAllocation[]) {
    update({
      monthly_source_allocations: allocations,
      monthly_source_category_id: allocations.find(
        (allocation) => allocation.budget_category_id != null && allocation.ratio > 0,
      )?.budget_category_id ?? null,
      confirm_monthly_unallocated: false,
    });
  }

  return (
    <Stack gap="xs" data-testid="depreciation-budget-fields">
      <Radio.Group
        label={t("depreciationBudgetMethodTitle")}
        value={value?.method ?? ""}
        onChange={changeMethod}
        name="depreciation-budget-method"
      >
        <Stack gap={6} mt={4}>
          {DEPRECIATION_BUDGET_METHOD_ORDER.map((method) => (
            <Radio
              key={method}
              value={method}
              label={t(`depreciationBudgetMethod${method}Label` as never)}
              description={t(`depreciationBudgetMethod${method}Hint` as never)}
              disabled={disabled}
            />
          ))}
        </Stack>
      </Radio.Group>

      {value?.method === "assigned" && (
        <Select
          label={t("depreciationBudgetPurchaseCategoryLabel")}
          placeholder={t("depreciationBudgetSelectCategory")}
          data={categories}
          value={
            value.purchase_category_id == null
              ? null
              : String(value.purchase_category_id)
          }
          onChange={(selected) =>
            update({
              purchase_category_id: selected ? Number(selected) : null,
            })
          }
          error={
            errors.purchaseCategory
              ? t("depreciationBudgetCategoryRequired")
              : undefined
          }
          searchable
          clearable
          required
          disabled={disabled}
        />
      )}

      {(value?.method === "assigned" || value?.method === "special") && (
        <DepreciationMonthlySourceEditor
          allocations={currentMonthlySourceAllocations}
          accountBudgetRatios={accountBudgetRatios}
          representativeAmount={representativeMonthlyAmount}
          expenseAccountName={expenseAccountName}
          currency={currency || displayCurrency || "JPY"}
          decimalPlaces={decimalPlaces}
          confirmUnallocated={value.confirm_monthly_unallocated === true}
          destinationCategoryId={value.method === "assigned" ? value.purchase_category_id : null}
          onChange={changeMonthlySources}
          onConfirmUnallocatedChange={(confirmed) =>
            update({ confirm_monthly_unallocated: confirmed })
          }
          disabled={disabled}
        />
      )}
      {errors.monthlySourceCategory === "must_differ" && (
        <Text size="xs" c="red">{t("depreciationBudgetCategoriesMustDiffer")}</Text>
      )}
      {errors.monthlySourceCategory === "required" && (
        <Text size="xs" c="red">{t("depreciationBudgetCategoryRequired")}</Text>
      )}
      {errors.monthlySourceAllocations === "invalid" && (
        <Text size="xs" c="red">{t("depreciationBudgetMonthlySourceInvalid")}</Text>
      )}
      {errors.confirmMonthlyUnallocated === "required" && (
        <Text size="xs" c="red">{t("depreciationBudgetMonthlySourceUnallocatedConfirm")}</Text>
      )}

      {assignedPurchaseWouldBeNegative && purchaseCategory && (
        <Alert color="yellow" icon={<IconAlertTriangle size={16} />} data-testid="depreciation-purchase-negative-warning">
          {t("depreciationBudgetAssignedNegativeWarning")}
          <Text size="xs" mt={4}>
            {t("budgetCategoryLabel")}: {purchaseCategory.category.name} ·{" "}
            {formatCurrency(
              predictedPurchaseBalance!,
              locale,
              currency || displayCurrency || "JPY",
            )}
          </Text>
        </Alert>
      )}

      {value?.method === "unallocated" && (
        <Alert color="yellow" icon={<IconInfoCircle size={16} />}>
          <Text size="sm">{t("depreciationBudgetUnallocatedWarning")}</Text>
          <Checkbox
            mt="xs"
            label={t("depreciationBudgetUnallocatedConfirm")}
            checked={value.confirm_unallocated === true}
            onChange={(event) =>
              update({ confirm_unallocated: event.currentTarget.checked })
            }
            error={
              errors.confirmUnallocated
                ? t("depreciationBudgetConfirmationRequired")
                : undefined
            }
            disabled={disabled}
          />
        </Alert>
      )}
    </Stack>
  );
}
