import {
  Badge,
  Checkbox,
  Collapse,
  Group,
  NumberInput,
  ScrollArea,
  Select,
  SegmentedControl,
  Stack,
  Text,
  UnstyledButton,
} from "@mantine/core";
import type { UseFormReturnType } from "@mantine/form";
import { IconAlertTriangle } from "@tabler/icons-react";
import { useState } from "react";
import type {
  Account,
  BudgetCategory,
  UnsettledLoanEntry,
} from "@balance-sheet/shared";
import {
  isAnyLendingCategory,
  isLongTermBorrowingCategory,
  isShortTermBorrowingCategory,
  isShortTermLoanCategory,
} from "@balance-sheet/shared";
import { budgetAccountDelta } from "../../../../shared/budgetScope";
import { useLang } from "../../i18n";
import { suggestLendingFundingSplit } from "../../lib/budgetFundingAllocation";
import { computeBudgetDistributionAmounts, getLoanSettlementDifference } from "../../lib/simpleEntryUtils";
import { formatCurrency } from "../../lib/numberFormat";
import { renderAccountOption, type AccountOption } from "../../lib/accountSelect";
import {
  type BudgetDistributionItem,
  type HouseholdForm,
} from "../SimpleEntryForm";

type SelectData = AccountOption | { group: string; items: AccountOption[] };

interface Props {
  form: UseFormReturnType<HouseholdForm>;
  isMobile: boolean;
  loanCounterOptions: SelectData[];
  liabilityOptions: SelectData[];
  lendingOptions: AccountOption[];
  expenseOnlyOptions: AccountOption[];
  incomeOnlyOptions: AccountOption[];
  accounts: Account[];
  budgetCategories: BudgetCategory[];
  locale: string;
  selectedCurrency: string;
  currencyDecimalPlaces?: number;
  currencySymbol: string;
  unsettledEntries: UnsettledLoanEntry[];
  setUnsettledEntries: (v: UnsettledLoanEntry[]) => void;
  settledEntryIds: number[];
  setSettledEntryIds: React.Dispatch<React.SetStateAction<number[]>>;
  isLoadingUnsettled: boolean;
  diffBudgetDist: BudgetDistributionItem[];
  setDiffBudgetDist: React.Dispatch<
    React.SetStateAction<BudgetDistributionItem[]>
  >;
  loanCounterBudgetDist: BudgetDistributionItem[];
  setLoanCounterBudgetDist: React.Dispatch<
    React.SetStateAction<BudgetDistributionItem[]>
  >;
  loanFundingCategoryAmounts: Record<number, number>;
  setLoanFundingCategoryAmounts: React.Dispatch<
    React.SetStateAction<Record<number, number>>
  >;
  currentUnallocatedFunding: number;
  showFundingSuggestion: boolean;
  handleLoanCounterAccountChange: (v: string | null) => void;
  fixedCounterAccountId?: number;
}

export function LoanSection({
  form,
  isMobile,
  loanCounterOptions,
  liabilityOptions,
  lendingOptions,
  expenseOnlyOptions,
  incomeOnlyOptions,
  accounts,
  budgetCategories,
  locale,
  selectedCurrency,
  currencyDecimalPlaces = 0,
  currencySymbol,
  unsettledEntries,
  setUnsettledEntries,
  settledEntryIds,
  setSettledEntryIds,
  isLoadingUnsettled,
  diffBudgetDist,
  setDiffBudgetDist,
  loanCounterBudgetDist,
  setLoanCounterBudgetDist,
  loanFundingCategoryAmounts,
  setLoanFundingCategoryAmounts,
  currentUnallocatedFunding,
  showFundingSuggestion,
  handleLoanCounterAccountChange,
  fixedCounterAccountId,
}: Props) {
  const { t } = useLang();
  const [showZeroCategories, setShowZeroCategories] = useState(false);

  const loanAccountId = form.values.loanAccountId;
  const loanDirection = form.values.loanDirection;
  const loanAccount =
    loanAccountId != null
      ? accounts.find((account) => account.id === loanAccountId)
      : undefined;
  const counterAccountId = form.values.loanCounterAccountId;
  const counterAccount =
    counterAccountId != null
      ? accounts.find((account) => account.id === counterAccountId)
      : undefined;
  const creditCardInvolved = [loanAccount, counterAccount].some(
    (account) =>
      account?.type === "liability" && account.category === "credit_card",
  );
  const isBorrowingDirection =
    loanDirection === "increase" || loanDirection === "decrease";
  const loanAccountSupportsFunding = isBorrowingDirection
    ? Boolean(
        loanAccount &&
          loanAccount.type === "liability" &&
          (isShortTermBorrowingCategory(loanAccount.category) ||
            isLongTermBorrowingCategory(loanAccount.category)),
      )
    : Boolean(
        loanAccount &&
          loanAccount.type === "asset" &&
          isAnyLendingCategory(loanAccount.category),
      );
  const principalDebitAccountId =
    loanDirection === "increase" || loanDirection === "collect"
      ? counterAccountId
      : loanAccountId;
  const principalCreditAccountId =
    loanDirection === "increase" || loanDirection === "collect"
      ? loanAccountId
      : counterAccountId;
  const settlementPrincipalAmount =
    loanDirection === "decrease" || loanDirection === "collect"
      ? unsettledEntries
          .filter((entry) => settledEntryIds.includes(entry.journal_entry_id))
          .reduce((sum, entry) => sum + entry.amount, 0)
      : 0;
  const fundingPrincipalAmount =
    settlementPrincipalAmount > 0
      ? settlementPrincipalAmount
      : form.values.amount;
  const fundingCashAmount = form.values.amount;
  const fundingResourceDelta =
    principalDebitAccountId != null && principalCreditAccountId != null
      ? budgetAccountDelta(
          [
            {
              account_id: principalDebitAccountId,
              debit:
                loanDirection === "increase" || loanDirection === "collect"
                  ? fundingCashAmount
                  : fundingPrincipalAmount,
              credit: 0,
              currency: selectedCurrency,
            },
            {
              account_id: principalCreditAccountId,
              debit: 0,
              credit:
                loanDirection === "increase" || loanDirection === "collect"
                  ? fundingPrincipalAmount
                  : fundingCashAmount,
              currency: selectedCurrency,
            },
          ],
          accounts,
          selectedCurrency,
        )
      : 0;
  const appliedBudgetPrincipal = Math.min(
    Math.max(0, fundingPrincipalAmount),
    Math.max(
      0,
      loanDirection === "increase" || loanDirection === "collect"
        ? fundingResourceDelta
        : -fundingResourceDelta,
    ),
  );
  const hasCompleteFundingLines =
    loanAccountId != null &&
    counterAccountId != null &&
    fundingPrincipalAmount > 0;
  const showFundingControls =
    !creditCardInvolved &&
    hasCompleteFundingLines &&
    loanAccountSupportsFunding &&
    appliedBudgetPrincipal > 0.000_001;
  const showFundingNoImpactHint =
    !creditCardInvolved &&
    hasCompleteFundingLines &&
    loanAccountSupportsFunding &&
    appliedBudgetPrincipal <= 0.000_001;
  const automaticFundingReversal =
    (loanDirection === "decrease" || loanDirection === "collect") &&
    settledEntryIds.length > 0;
  const assignedFunding = Object.values(loanFundingCategoryAmounts).reduce(
    (sum, amount) => sum + (Number(amount) || 0),
    0,
  );
  const unallocatedFunding = form.values.amount - assignedFunding;
  const lendingSuggestion = suggestLendingFundingSplit(
    form.values.amount,
    currentUnallocatedFunding,
  );
  const loanCounterBudgetAmounts = computeBudgetDistributionAmounts(
    form.values.amount,
    loanCounterBudgetDist,
    currencyDecimalPlaces,
  );

  const counterAcctType = counterAccount?.type;
  const showLendingSuggestion =
    showFundingSuggestion &&
    loanDirection === "lend" &&
    counterAccount?.type === "asset" &&
    counterAccount.category === "cash" &&
    counterAccount.include_in_allocatable !== false;

  const counterLabel =
    loanDirection === "increase"
      ? counterAcctType === "expense"
        ? t("loanCounterIncreaseExpense")
        : counterAcctType === "liability"
          ? t("loanCounterIncreaseLiability")
          : t("loanCounterIncrease")
      : loanDirection === "decrease"
        ? counterAcctType === "liability"
          ? t("loanCounterDecreaseLiability")
          : counterAcctType === "income"
            ? t("loanCounterDecreaseIncome")
            : t("loanCounterDecrease")
        : loanDirection === "lend"
          ? counterAcctType === "liability"
            ? t("loanCounterLendLiability")
            : t("loanCounterLend")
          : counterAcctType === "expense"
            ? t("loanCounterExpenseCovered")
            : t("loanCounterCollect");

  return (
    <>
      <ScrollArea scrollbars="x" type="hover" scrollbarSize={6}>
        <SegmentedControl
          data={[
            { value: "increase", label: t("loanIncrease") },
            { value: "decrease", label: t("loanDecrease") },
            { value: "lend", label: t("loanLend") },
            { value: "collect", label: t("loanCollect") },
          ]}
          value={loanDirection}
          onChange={(v) => {
            form.setFieldValue("loanDirection", v as typeof loanDirection);
            form.setFieldValue(
              "loanCounterAccountId",
              fixedCounterAccountId ?? null,
            );
            form.setFieldValue("loanAccountId", null);
            setUnsettledEntries([]);
            setSettledEntryIds([]);
            setLoanFundingCategoryAmounts({});
            handleLoanCounterAccountChange(
              fixedCounterAccountId != null
                ? String(fixedCounterAccountId)
                : null,
            );
          }}
          style={{ minWidth: 320 }}
        />
      </ScrollArea>
      <Select
        label={
          loanDirection === "lend" || loanDirection === "collect"
            ? t("lendingAccountLabel")
            : t("liabilityAccountLabel")
        }
        placeholder={t("selectAccount")}
        data={
          loanDirection === "lend" || loanDirection === "collect"
            ? lendingOptions
            : liabilityOptions
        }
        searchable={!isMobile}
        required
        value={loanAccountId != null ? String(loanAccountId) : null}
        onChange={(v) => {
          form.setFieldValue("loanAccountId", v ? Number(v) : null);
          setSettledEntryIds([]);
        }}
        error={form.errors.loanAccountId}
        renderOption={renderAccountOption as any}
      />
      <Select
        label={counterLabel}
        placeholder={t("selectAccount")}
        data={loanCounterOptions}
        searchable={!isMobile}
        required
        disabled={fixedCounterAccountId != null}
        value={
          form.values.loanCounterAccountId != null
            ? String(form.values.loanCounterAccountId)
            : null
        }
        onChange={handleLoanCounterAccountChange}
        error={form.errors.loanCounterAccountId}
        renderOption={renderAccountOption as any}
      />

      {(loanDirection === "increase" || loanDirection === "collect") &&
        loanCounterBudgetDist.length > 0 &&
        accounts.find((a) => a.id === form.values.loanCounterAccountId)
          ?.type === "expense" &&
        (() => {
          const primaryDist = loanCounterBudgetDist.filter((d) => !d.isDefault);
          const zeroDist = loanCounterBudgetDist.filter((d) => d.isDefault);
          const totalRatio = loanCounterBudgetDist.reduce(
            (s, d) => s + d.ratio,
            0,
          );
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
                  setLoanCounterBudgetDist((prev) =>
                    prev.map((d) =>
                      d.budget_category_id === dist.budget_category_id
                        ? { ...d, ratio: Number(v) || 0 }
                        : d,
                    ),
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
                  form.values.amount > 0
                    ? loanCounterBudgetAmounts.get(dist.budget_category_id) ?? 0
                    : 0
                }
                onChange={(v) => {
                  const newRatio =
                    form.values.amount > 0
                      ? Math.round((Number(v) / form.values.amount) * 100)
                      : 0;
                  setLoanCounterBudgetDist((prev) =>
                    prev.map((d) =>
                      d.budget_category_id === dist.budget_category_id
                        ? { ...d, ratio: newRatio }
                        : d,
                    ),
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
                    totalRatio > 100
                      ? "red"
                      : totalRatio > 0 && totalRatio < 100
                        ? "yellow"
                        : "teal"
                  }
                  leftSection={
                    totalRatio > 0 && totalRatio < 100 ? (
                      <IconAlertTriangle size={10} />
                    ) : undefined
                  }
                >
                  {t("budgetDistributionTotal")}: {totalRatio}%
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

      <NumberInput
        label={t("amountLabel")}
        placeholder="0"
        required
        min={0}
        prefix={currencySymbol}
        thousandSeparator=","
        {...form.getInputProps("amount")}
      />

      {showFundingControls ? (
        <Stack gap="xs">
          <Text size="sm" fw={600}>
            {t("loanFundingBreakdownTitle")}
          </Text>
          {automaticFundingReversal ? (
            <Text size="xs" c="dimmed">
              {t("loanFundingSettlementAutomatic")}
            </Text>
          ) : (
            <>
              <Text size="xs" c="dimmed">
                {t("loanFundingBreakdownHint")}
              </Text>
              {showLendingSuggestion && (
                <Group gap="xs" wrap="wrap">
                  <Badge size="sm" variant="light" color="gray">
                    {t("loanFundingCurrentUnallocated")}:{" "}
                    {formatCurrency(
                      lendingSuggestion.absorbedByUnallocated,
                      locale,
                      selectedCurrency,
                      currencySymbol,
                    )}
                  </Badge>
                  <Badge size="sm" variant="light" color="orange">
                    {t("loanFundingSuggestedConstraint")}:{" "}
                    {formatCurrency(
                      lendingSuggestion.suggestedCategoryConstraint,
                      locale,
                      selectedCurrency,
                      currencySymbol,
                    )}
                  </Badge>
                </Group>
              )}
              {budgetCategories.map((category) => (
                <Group key={category.id} justify="space-between" gap="xs">
                  <Text size="sm">{category.name}</Text>
                  <NumberInput
                    w={150}
                    size="xs"
                    min={0}
                    max={Math.max(0, form.values.amount)}
                    prefix={currencySymbol}
                    thousandSeparator=","
                    value={loanFundingCategoryAmounts[category.id] ?? 0}
                    onChange={(value) =>
                      setLoanFundingCategoryAmounts((current) => ({
                        ...current,
                        [category.id]: Number(value) || 0,
                      }))
                    }
                  />
                </Group>
              ))}
              <Group justify="space-between">
                <Text size="sm" fw={600}>
                  {t("loanFundingUnallocated")}
                </Text>
                <Text
                  size="sm"
                  fw={600}
                  c={unallocatedFunding >= 0 ? "teal" : "red"}
                >
                  {formatCurrency(
                    unallocatedFunding,
                    locale,
                    selectedCurrency,
                    currencySymbol,
                  )}
                </Text>
              </Group>
              {unallocatedFunding < 0 && (
                <Text size="xs" c="red">
                  {t("loanFundingExceedsPrincipal")}
                </Text>
              )}
            </>
          )}
          <Text size="xs" c="dimmed">
            {t("loanFundingResetBoundaryHint")}
          </Text>
        </Stack>
      ) : showFundingNoImpactHint ? (
        <Text size="xs" c="dimmed">
          {t("loanFundingNoBudgetImpactHint")}
        </Text>
      ) : null}

      {(loanDirection === "decrease" || loanDirection === "collect") &&
        (() => {
          if (creditCardInvolved) return null;
          const loanAcct =
            loanAccountId != null
              ? accounts.find((a) => a.id === loanAccountId)
              : undefined;
          if (loanAcct && !isShortTermLoanCategory(loanAcct.category))
            return null;
          const selectedTotal = unsettledEntries
            .filter((e) => settledEntryIds.includes(e.journal_entry_id))
            .reduce((s, e) => s + e.amount, 0);
          const diff = settledEntryIds.length > 0
            ? getLoanSettlementDifference(form.values.amount, selectedTotal, currencyDecimalPlaces)
            : 0;
          const diffBudgetAmounts = computeBudgetDistributionAmounts(
            Math.abs(diff),
            diffBudgetDist,
            currencyDecimalPlaces,
          );
          const hasDiff = settledEntryIds.length > 0 && Math.abs(diff) > 0;
          const diffIsExpense =
            (loanDirection === "decrease" && diff > 0) ||
            (loanDirection === "collect" && diff < 0);
          const diffAccountOptions = diffIsExpense
            ? [{ group: t("typeExpense"), items: expenseOnlyOptions }]
            : [{ group: t("typeIncome"), items: incomeOnlyOptions }];

          return (
            <>
              <Stack gap={4}>
                <Text size="xs" fw={500}>
                  {t("selectSettlementEntries")}
                </Text>
                {isLoadingUnsettled ? (
                  <Text size="xs" c="dimmed">
                    …
                  </Text>
                ) : unsettledEntries.length === 0 ? (
                  <Text size="xs" c="dimmed">
                    {t("noUnsettledEntries")}
                  </Text>
                ) : (
                  <>
                    {unsettledEntries.map((entry) => (
                      <Group
                        key={entry.journal_entry_id}
                        gap="xs"
                        align="center"
                      >
                        <Checkbox
                          checked={settledEntryIds.includes(
                            entry.journal_entry_id,
                          )}
                          onChange={(e) => {
                            if (e.currentTarget.checked) {
                              setSettledEntryIds((prev) => [
                                ...prev,
                                entry.journal_entry_id,
                              ]);
                            } else {
                              setSettledEntryIds((prev) =>
                                prev.filter(
                                  (id) => id !== entry.journal_entry_id,
                                ),
                              );
                            }
                          }}
                        />
                        <Text size="sm" flex={1}>
                          {entry.description}
                        </Text>
                        <Text size="xs" c="dimmed">
                          {entry.date}
                        </Text>
                        <Text size="sm" fw={500}>
                          {formatCurrency(
                            entry.amount,
                            locale,
                            entry.currency,
                            entry.currency === selectedCurrency
                              ? currencySymbol
                              : undefined,
                          )}
                        </Text>
                      </Group>
                    ))}
                    {settledEntryIds.length > 0 && (
                      <Group justify="flex-end" gap="xs">
                        <Text size="xs" c="dimmed">
                          {t("settlementSelectedTotal")}:
                        </Text>
                        <Text size="sm" fw={500}>
                          {formatCurrency(
                            selectedTotal,
                            locale,
                            selectedCurrency,
                            currencySymbol,
                          )}
                        </Text>
                      </Group>
                    )}
                  </>
                )}
              </Stack>

              {hasDiff && (
                <>
                  <Text size="xs" c={diffIsExpense ? "orange" : "teal"}>
                    {diffIsExpense
                      ? t("loanDifferenceLoss")
                      : t("loanDifferenceIncome")}
                    :{" "}
                    {formatCurrency(
                      Math.abs(diff),
                      locale,
                      selectedCurrency,
                      currencySymbol,
                    )}
                  </Text>
                  <Select
                    label={t("loanDifferenceAccountLabel")}
                    placeholder={t("selectAccount")}
                    data={diffAccountOptions}
                    clearable
                    renderOption={renderAccountOption as any}
                    value={
                      form.values.loanDifferenceAccountId != null
                        ? String(form.values.loanDifferenceAccountId)
                        : null
                    }
                    onChange={(v) => {
                      form.setFieldValue(
                        "loanDifferenceAccountId",
                        v ? Number(v) : null,
                      );
                      setDiffBudgetDist([]);
                      if (v) {
                        const acct = accounts.find((a) => a.id === Number(v));
                        if (acct?.type === "expense") {
                          const ratios = acct.budget_ratios ?? [];
                          const configuredIds = new Set(
                            ratios.map((r) => r.budget_category_id),
                          );
                          setDiffBudgetDist([
                            ...ratios.map((r) => ({
                              budget_category_id: r.budget_category_id,
                              name:
                                r.budget_category_name ??
                                `#${r.budget_category_id}`,
                              ratio: r.ratio,
                              isDefault: r.ratio === 0,
                            })),
                            ...budgetCategories
                              .filter((c) => !configuredIds.has(c.id))
                              .map((c) => ({
                                budget_category_id: c.id,
                                name: c.name,
                                ratio: 0,
                                isDefault: true,
                              })),
                          ]);
                        }
                      }
                    }}
                  />
                  {diffBudgetDist.length > 0 &&
                    form.values.loanDifferenceAccountId != null &&
                    accounts.find(
                      (a) => a.id === form.values.loanDifferenceAccountId,
                    )?.type === "expense" && (
                      <Stack gap={4}>
                        <Text size="xs" c="dimmed">
                          {t("budgetAllocationDisplay")}
                        </Text>
                        {diffBudgetDist
                          .filter((d) => !d.isDefault)
                          .map((dist) => (
                            <Group
                              key={dist.budget_category_id}
                              gap="xs"
                              align="center"
                            >
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
                                  setDiffBudgetDist((prev) =>
                                    prev.map((d) =>
                                      d.budget_category_id ===
                                      dist.budget_category_id
                                        ? { ...d, ratio: Number(v) || 0 }
                                        : d,
                                    ),
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
                                  Math.abs(diff) > 0
                                    ? diffBudgetAmounts.get(dist.budget_category_id) ?? 0
                                    : 0
                                }
                                onChange={(v) => {
                                  const newRatio =
                                    Math.abs(diff) > 0
                                      ? Math.round(
                                          (Number(v) / Math.abs(diff)) * 100,
                                        )
                                      : 0;
                                  setDiffBudgetDist((prev) =>
                                    prev.map((d) =>
                                      d.budget_category_id ===
                                      dist.budget_category_id
                                        ? { ...d, ratio: newRatio }
                                        : d,
                                    ),
                                  );
                                }}
                              />
                            </Group>
                          ))}
                      </Stack>
                    )}
                </>
              )}
            </>
          );
        })()}
    </>
  );
}
