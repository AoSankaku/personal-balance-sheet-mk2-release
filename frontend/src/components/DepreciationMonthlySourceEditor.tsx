import {
  Alert,
  Button,
  Checkbox,
  Collapse,
  Group,
  NumberInput,
  Stack,
  Text,
  UnstyledButton,
} from "@mantine/core";
import { IconAlertTriangle, IconRotate } from "@tabler/icons-react";
import { useId, useMemo, useRef, useState } from "react";
import type {
  AccountBudgetRatio,
  DepreciationBudgetSourceAllocation,
} from "@balance-sheet/shared";
import { useAppData } from "../context/AppDataContext";
import { useLang } from "../i18n";
import { splitDepreciationMonthlySourceAllocations, validateDepreciationMonthlySourceAllocations } from "@balance-sheet/shared";
import { getEffectiveSymbol } from "../lib/currencyUtils";
import { formatCurrency, parseCurrencyInputValue } from "../lib/numberFormat";
import { buildDepreciationMonthlySourceDefaults } from "../lib/depreciationMonthlySources";

interface Props {
  allocations: DepreciationBudgetSourceAllocation[];
  accountBudgetRatios?: AccountBudgetRatio[];
  representativeAmount: number;
  expenseAccountName?: string;
  currency: string;
  decimalPlaces: number;
  confirmUnallocated: boolean;
  destinationCategoryId?: number | null;
  onChange: (allocations: DepreciationBudgetSourceAllocation[]) => void;
  onConfirmUnallocatedChange: (confirmed: boolean) => void;
  disabled?: boolean;
}

function allocationOrder(
  left: DepreciationBudgetSourceAllocation,
  right: DepreciationBudgetSourceAllocation,
) {
  if (left.budget_category_id == null) return right.budget_category_id == null ? 0 : 1;
  if (right.budget_category_id == null) return -1;
  return left.budget_category_id - right.budget_category_id;
}

export function DepreciationMonthlySourceEditor({
  allocations,
  accountBudgetRatios = [],
  representativeAmount,
  expenseAccountName,
  currency,
  decimalPlaces,
  confirmUnallocated,
  destinationCategoryId,
  onChange,
  onConfirmUnallocatedChange,
  disabled = false,
}: Props) {
  const { t, locale } = useLang();
  const { budgetCategories, enabledCurrencies } = useAppData();
  const currencySymbol = getEffectiveSymbol(currency, enabledCurrencies);
  const [showZeroCategories, setShowZeroCategories] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const generatedId = useId().replace(/:/g, "");
  const zeroCategoriesId = `monthly-source-zero-${generatedId}`;
  const helpId = `monthly-source-help-${generatedId}`;
  const touchedAmountInputs = useRef(new Set<string>());
  const factor = 10 ** Math.max(0, Math.min(12, decimalPlaces));
  const representativeMinorUnits = Math.max(
    0,
    Math.round(representativeAmount * factor),
  );

  const defaults = useMemo(
    () => buildDepreciationMonthlySourceDefaults(budgetCategories, accountBudgetRatios),
    [accountBudgetRatios, budgetCategories],
  );
  const categoryById = new Map(budgetCategories.map((category) => [category.id, category]));
  const displayedAllocations = useMemo(() => {
    const byId = new Map<number | null, DepreciationBudgetSourceAllocation>();
    for (const allocation of allocations) byId.set(allocation.budget_category_id, allocation);
    for (const category of budgetCategories) {
      if (!category.is_archived && !byId.has(category.id)) {
        byId.set(category.id, { budget_category_id: category.id, ratio: 0 });
      }
    }
    if (!byId.has(null)) byId.set(null, { budget_category_id: null, ratio: 0 });
    return [...byId.values()].sort(allocationOrder);
  }, [allocations, budgetCategories]);

  const totalRatio = displayedAllocations.reduce((sum, allocation) => sum + allocation.ratio, 0);
  const allocationError = validateDepreciationMonthlySourceAllocations(allocations);
  const hasUnallocatedShare =
    (allocations.find((allocation) => allocation.budget_category_id == null)?.ratio ?? 0) > 0;
  const sameAsDestination =
    destinationCategoryId != null &&
    allocations.some(
      (allocation) =>
        allocation.budget_category_id === destinationCategoryId &&
        allocation.ratio > 0,
    );

  const amountById = new Map<number | null, number>();
  if (validateDepreciationMonthlySourceAllocations(allocations) == null) {
    for (const allocation of splitDepreciationMonthlySourceAllocations(
      representativeMinorUnits,
      allocations,
    )) {
      amountById.set(allocation.budget_category_id, allocation.amount / factor);
    }
  } else {
    for (const allocation of displayedAllocations) {
      amountById.set(
        allocation.budget_category_id,
        (representativeAmount * allocation.ratio) / 100,
      );
    }
  }

  function emit(next: DepreciationBudgetSourceAllocation[]) {
    const sorted = next
      .filter((item) => item.ratio > 0)
      .map((item) => ({ ...item }))
      .sort(allocationOrder);
    onChange(sorted);
  }

  function updateNamedRatio(categoryId: number, ratio: number) {
    const next = displayedAllocations.map((allocation) =>
      allocation.budget_category_id === categoryId
        ? { ...allocation, ratio }
        : { ...allocation },
    );
    const namedTotal = next
      .filter((allocation) => allocation.budget_category_id != null)
      .reduce((sum, allocation) => sum + allocation.ratio, 0);
    const unallocated = next.find((allocation) => allocation.budget_category_id == null)!;
    unallocated.ratio = Math.max(0, 100 - namedTotal);
    emit(next);
  }

  function updateUnallocatedRatio(ratio: number) {
    emit(
      displayedAllocations.map((allocation) =>
        allocation.budget_category_id == null
          ? { ...allocation, ratio }
          : { ...allocation },
      ),
    );
  }

  function updateAmount(categoryId: number | null, amount: number) {
    if (representativeMinorUnits <= 0) return;
    const nextRatio = (Math.round(amount * factor) / representativeMinorUnits) * 100;
    if (categoryId == null) {
      updateUnallocatedRatio(nextRatio);
    } else {
      updateNamedRatio(categoryId, nextRatio);
    }
  }

  function renderRow(allocation: DepreciationBudgetSourceAllocation) {
    const categoryId = allocation.budget_category_id;
    const category = categoryId == null ? undefined : categoryById.get(categoryId);
    const label = categoryId == null
      ? t("depreciationBudgetUnallocatedSource")
      : category?.name ?? `${t("unknownCategoryPrefix")}${categoryId}`;
    const rowAmount = amountById.get(categoryId) ?? 0;
    const name = categoryId == null ? "unallocated" : String(categoryId);
    return (
      <div
        key={name}
        data-testid={`monthly-source-row-${name}`}
        style={{
          display: "grid",
          gridTemplateColumns:
            "minmax(0, 1fr) minmax(72px, 96px) minmax(108px, 130px)",
          gap: 8,
          alignItems: "center",
          minHeight: 44,
        }}
      >
        <Text size="sm" style={{ minWidth: 0, overflowWrap: "anywhere" }} c={category?.is_archived ? "dimmed" : undefined}>
          {label}
          {category?.is_archived ? ` (${t("archivedBudgetCategoryBadge")})` : ""}
        </Text>
        <NumberInput
          aria-label={`${label} ${t("depreciationBudgetMonthlySourceRatioLabel")}`}
          data-testid={`monthly-source-ratio-${name}`}
          size="sm"
          styles={{ input: { minHeight: 40 } }}
          min={0}
          max={100}
          decimalScale={12}
          suffix="%"
          value={allocation.ratio}
          onChange={(value) => {
            const ratio = Number(value);
            if (categoryId == null) updateUnallocatedRatio(Number.isFinite(ratio) ? ratio : 0);
            else updateNamedRatio(categoryId, Number.isFinite(ratio) ? ratio : 0);
          }}
          disabled={disabled}
        />
        <NumberInput
          aria-label={`${label} ${t("depreciationBudgetMonthlySourceAmountLabel")}`}
          data-testid={`monthly-source-amount-${name}`}
          size="sm"
          styles={{ input: { minHeight: 40 } }}
          min={0}
          decimalScale={decimalPlaces}
          prefix={`${currencySymbol} `}
          thousandSeparator=","
          hideControls
          value={rowAmount}
          onInput={() => touchedAmountInputs.current.add(name)}
          onChange={(value) => {
            const amount = Number(value);
            updateAmount(categoryId, Number.isFinite(amount) ? amount : 0);
          }}
          onBlur={(event) => {
            if (!touchedAmountInputs.current.delete(name)) return;
            const amount = parseCurrencyInputValue(
              event.currentTarget.value,
              currencySymbol,
            );
            if (amount != null) updateAmount(categoryId, Math.max(0, amount));
          }}
          disabled={disabled || representativeMinorUnits <= 0}
        />
      </div>
    );
  }

  const positiveRows = displayedAllocations.filter(
    (allocation) => allocation.ratio > 0,
  );
  const zeroRows = displayedAllocations.filter(
    (allocation) => allocation.ratio <= 0,
  );

  return (
    <Stack
      gap="xs"
      data-testid="depreciation-monthly-source-editor"
      style={{ width: "100%", maxWidth: 660 }}
    >
      <Group justify="space-between" align="flex-start" gap="xs">
        <div>
          <Text size="sm" fw={600}>{t("depreciationBudgetMonthlySourceTitle")}</Text>
        </div>
        <Button
          size="sm"
          h={40}
          variant="subtle"
          leftSection={<IconRotate size={14} />}
          data-testid="monthly-source-restore-defaults"
          onClick={() => emit(defaults)}
          disabled={disabled}
        >
          {t("depreciationBudgetMonthlySourceRestoreDefaults")}
        </Button>
      </Group>

      <Group justify="space-between" gap="xs">
        <Text size="xs" c="dimmed">{t("depreciationBudgetMonthlySourceRepresentativeAmount")}</Text>
        <Text size="xs" fw={600} data-testid="monthly-source-representative-amount">
          {formatCurrency(
            representativeAmount,
            locale,
            currency,
            currencySymbol,
            decimalPlaces,
          )}
        </Text>
      </Group>

      <Stack gap={4}>
        <div
          aria-hidden="true"
          style={{
            display: "grid",
            gridTemplateColumns:
              "minmax(0, 1fr) minmax(72px, 96px) minmax(108px, 130px)",
            gap: 8,
            alignItems: "end",
          }}
        >
          <Text size="xs" c="dimmed">{t("depreciationBudgetMonthlySourceCategoryColumn")}</Text>
          <Text size="xs" c="dimmed" ta="right">{t("depreciationBudgetMonthlySourceRatioColumn")}</Text>
          <Text size="xs" c="dimmed" ta="right">{t("depreciationBudgetMonthlySourceAmountColumn")}</Text>
        </div>
        {positiveRows.map(renderRow)}
        {zeroRows.length > 0 && (
          <>
            <UnstyledButton
              onClick={() => setShowZeroCategories((current) => !current)}
              data-testid="monthly-source-zero-categories-toggle"
              aria-expanded={showZeroCategories}
              aria-controls={zeroCategoriesId}
              style={{ minHeight: 40, alignSelf: "flex-start" }}
              disabled={disabled}
            >
              <Text size="xs" c="dimmed">
                {showZeroCategories ? "▼" : "▶"} {t("depreciationBudgetMonthlySourceOtherCategories")} ({zeroRows.length})
              </Text>
            </UnstyledButton>
            <Collapse in={showZeroCategories} id={zeroCategoriesId}>
              <Stack gap={4}>{zeroRows.map(renderRow)}</Stack>
            </Collapse>
          </>
        )}
      </Stack>

      <Group justify="space-between" gap="xs" data-testid="monthly-source-total">
        <Text size="sm" fw={600}>{t("budgetDistributionTotal")}</Text>
        <Text
          size="sm"
          fw={700}
          c={allocationError ? "red" : "teal"}
          data-testid="monthly-source-total-ratio"
        >
          {totalRatio.toLocaleString(locale, { maximumFractionDigits: 6 })}%
        </Text>
      </Group>
      {allocationError && (
        <Text size="xs" c="red" role="alert" data-testid="monthly-source-allocation-error">
          {t("depreciationBudgetMonthlySourceInvalid")}
        </Text>
      )}
      {sameAsDestination && (
        <Text size="xs" c="red" role="alert" data-testid="monthly-source-destination-error">
          {t("depreciationBudgetSourceDestinationMustDiffer")}
        </Text>
      )}

      {hasUnallocatedShare && (
        <Alert color="yellow" icon={<IconAlertTriangle size={16} />}>
          <Text size="xs">{t("depreciationBudgetMonthlySourceUnallocatedHint")}</Text>
          <Checkbox
            mt="xs"
            label={t("depreciationBudgetMonthlySourceUnallocatedConfirm")}
            data-testid="monthly-source-unallocated-consent"
            checked={confirmUnallocated}
            onChange={(event) => onConfirmUnallocatedChange(event.currentTarget.checked)}
            error={confirmUnallocated ? undefined : t("depreciationBudgetConfirmationRequired")}
            disabled={disabled}
          />
        </Alert>
      )}

      <UnstyledButton
        onClick={() => setShowHelp((current) => !current)}
        data-testid="monthly-source-help-toggle"
        aria-expanded={showHelp}
        aria-controls={helpId}
        style={{ minHeight: 40, alignSelf: "flex-start" }}
        disabled={disabled}
      >
        <Text size="sm" c="blue">
          {showHelp ? "▼" : "▶"} {t("depreciationBudgetMonthlySourceHelp")}
        </Text>
      </UnstyledButton>
      <Collapse in={showHelp} id={helpId}>
        <Stack gap={4}>
          <Text size="xs" c="dimmed">{t("depreciationBudgetMonthlySourceHint")}</Text>
          {expenseAccountName ? (
            <Text size="xs" data-testid="monthly-source-expense-account">
              {t("depreciationBudgetExpenseAccountContext").replace("{account}", expenseAccountName)}
            </Text>
          ) : null}
          <Text size="xs" c="dimmed">{t("depreciationBudgetMonthlySourceManualAmountHint")}</Text>
        </Stack>
      </Collapse>
    </Stack>
  );
}
