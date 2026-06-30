import {
  Button,
  Checkbox,
  Divider,
  Group,
  Modal,
  NumberInput,
  Select,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { useEffect } from "react";
import type {
  Account,
  AccountBudgetRatio,
  AccountCategory,
  AccountType,
  BudgetCategory,
  CreateAccountInput,
} from "@balance-sheet/shared";
import { ApiError } from "../api/client";
import { useLang, type TranslationKey } from "../i18n";
import {
  isUserSelectableAccount,
  toAccountSelectOption,
} from "../lib/accountUtils";
import { renderAccountOption } from "../lib/accountSelect";

const CLOSING_DAY_BASE_OPTIONS = Array.from({ length: 31 }, (_, i) => ({
  value: String(i + 1),
  label: String(i + 1),
}));

/**
 * CATEGORIES_BY_TYPE defines both the available categories and their display order.
 * Categories marked with `businessOwnerOnly: true` are hidden unless isBusinessOwner=true.
 * This ordering is the canonical order used throughout the project.
 */
type CategoryOption = {
  value: AccountCategory;
  labelKey: TranslationKey;
  businessOwnerOnly?: true;
};

const CATEGORIES_BY_TYPE: Record<AccountType, CategoryOption[]> = {
  asset: [
    { value: "cash", labelKey: "catCash" },
    { value: "short_term_lending", labelKey: "catShortTermLending" },
    { value: "long_term_lending", labelKey: "catLongTermLending" },
    {
      value: "business_advance",
      labelKey: "catBusinessAdvance",
      businessOwnerOnly: true,
    },
    { value: "investment", labelKey: "catInvestment" },
    { value: "crypto", labelKey: "catCrypto" },
    { value: "property", labelKey: "catProperty" },
    { value: "other", labelKey: "catOther" },
  ],
  liability: [
    { value: "credit_card", labelKey: "catCreditCard" },
    { value: "short_term_loan", labelKey: "catShortTermLoan" },
    { value: "long_term_loan", labelKey: "catLongTermLoan" },
    {
      value: "business_advance",
      labelKey: "catBusinessAdvance",
      businessOwnerOnly: true,
    },
    { value: "other", labelKey: "catOther" },
  ],
  equity: [
    { value: "opening_balance", labelKey: "catOpeningBalance" },
    { value: "other", labelKey: "catOther" },
  ],
  income: [
    { value: "salary", labelKey: "catSalary" },
    { value: "business", labelKey: "catBusiness" },
    { value: "investment", labelKey: "catInvestmentIncome" },
    { value: "other", labelKey: "catOther" },
  ],
  expense: [
    { value: "entertainment", labelKey: "catEntertainment" },
    { value: "food", labelKey: "catFood" },
    { value: "utilities", labelKey: "catUtilities" },
    { value: "daily_goods", labelKey: "catDailyGoods" },
    { value: "social", labelKey: "catSocial" },
    { value: "rent", labelKey: "catRent" },
    { value: "investment_loss", labelKey: "catInvestmentLoss" },
    { value: "transport", labelKey: "catTransport" },
    { value: "other", labelKey: "catOther" },
  ],
};

interface AccountFormValues {
  name: string;
  type: AccountType;
  category: AccountCategory;
  payday: number | string;
  is_depreciable: boolean;
  include_in_allocatable: boolean;
  budget_ratios: { budget_category_id: number; ratio: number | string }[];
  closing_day: string | null;
  confirmation_day: number | string;
  withdrawal_day: number | string;
  billing_offset_months: number | string;
  withdrawal_account_id: string | null;
}

export interface CreditCardSettingsInput {
  closing_day: number;
  confirmation_day: number;
  withdrawal_day: number;
  billing_offset_months: number;
  withdrawal_account_id?: number | null;
}

interface Props {
  opened: boolean;
  onClose: () => void;
  onSubmit: (
    values: CreateAccountInput,
    creditCardSettings?: CreditCardSettingsInput,
  ) => Promise<void>;
  editAccount?: Account;
  budgetCategories?: BudgetCategory[];
  existingCreditCardSettings?: CreditCardSettingsInput;
  isBusinessOwner?: boolean;
  withdrawalAccountOptions?: Account[];
}

export function AddAccountModal({
  opened,
  onClose,
  onSubmit,
  editAccount,
  budgetCategories = [],
  existingCreditCardSettings,
  isBusinessOwner = false,
  withdrawalAccountOptions = [],
}: Props) {
  const { t } = useLang();
  const isEdit = Boolean(editAccount);

  const form = useForm<AccountFormValues>({
    initialValues: {
      name: "",
      type: "asset",
      category: "cash",
      payday: "",
      is_depreciable: false,
      include_in_allocatable: true,
      budget_ratios: [],
      closing_day: null,
      confirmation_day: "",
      withdrawal_day: "",
      billing_offset_months: 0,
      withdrawal_account_id: null,
    },
    validate: {
      name: (v) => (v.trim().length === 0 ? t("nameIsRequired") : null),
    },
  });

  function buildInitialRatios(
    existingRatios?: AccountBudgetRatio[],
  ): { budget_category_id: number; ratio: number | string }[] {
    return budgetCategories.map((cat) => ({
      budget_category_id: cat.id,
      ratio:
        existingRatios?.find((r) => r.budget_category_id === cat.id)?.ratio ??
        0,
    }));
  }

  useEffect(() => {
    if (editAccount) {
      form.setValues({
        name: editAccount.name,
        type: editAccount.type,
        category: editAccount.category,
        payday: editAccount.payday ?? "",
        is_depreciable: editAccount.is_depreciable ?? false,
        include_in_allocatable: editAccount.include_in_allocatable ?? true,
        budget_ratios: buildInitialRatios(editAccount.budget_ratios),
        closing_day:
          existingCreditCardSettings != null
            ? String(existingCreditCardSettings.closing_day)
            : null,
        confirmation_day: existingCreditCardSettings?.confirmation_day ?? "",
        withdrawal_day: existingCreditCardSettings?.withdrawal_day ?? "",
        billing_offset_months:
          existingCreditCardSettings?.billing_offset_months ?? 0,
        withdrawal_account_id:
          existingCreditCardSettings?.withdrawal_account_id != null
            ? String(existingCreditCardSettings.withdrawal_account_id)
            : null,
      });
    } else {
      form.setValues({
        name: "",
        type: "asset",
        category: "cash",
        payday: "",
        is_depreciable: false,
        include_in_allocatable: true,
        budget_ratios: buildInitialRatios(),
        closing_day: null,
        confirmation_day: "",
        withdrawal_day: "",
        billing_offset_months: 0,
        withdrawal_account_id: null,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editAccount, opened, budgetCategories.length]);

  const selectedType = form.values.type;

  useEffect(() => {
    if (isEdit) return;
    const cats = CATEGORIES_BY_TYPE[selectedType];
    if (cats && !cats.find((c) => c.value === form.values.category)) {
      form.setFieldValue("category", cats[0]!.value);
    }
    if (selectedType === "expense") {
      form.setFieldValue("budget_ratios", buildInitialRatios());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedType]);

  async function handleSubmit(values: AccountFormValues) {
    const input: CreateAccountInput = {
      name: values.name,
      type: values.type,
      category: values.category,
    };

    if (values.type === "income") {
      const day = Number(values.payday);
      input.payday = day >= 1 && day <= 31 ? day : null;
    }

    if (values.type === "asset") {
      input.is_depreciable = values.is_depreciable;
      input.include_in_allocatable =
        values.category === "cash" ? values.include_in_allocatable : false;
    }

    if (values.type === "expense" && budgetCategories.length > 0) {
      input.budget_ratios = values.budget_ratios
        .map((r) => ({
          budget_category_id: r.budget_category_id,
          ratio: Number(r.ratio) || 0,
        }))
        .filter((r) => r.ratio > 0);
    }

    let ccSettings: CreditCardSettingsInput | undefined;
    if (values.type === "liability" && values.category === "credit_card") {
      const closingDay =
        values.closing_day !== null ? Number(values.closing_day) : NaN;
      const confirmationDay = Number(values.confirmation_day);
      const withdrawalDay = Number(values.withdrawal_day);
      const billingOffset = Number(values.billing_offset_months);

      if (
        !Number.isNaN(closingDay) &&
        (closingDay === 0 || (closingDay >= 1 && closingDay <= 31)) &&
        confirmationDay >= 1 &&
        confirmationDay <= 31 &&
        withdrawalDay >= 1 &&
        withdrawalDay <= 31 &&
        Number.isInteger(billingOffset) &&
        billingOffset >= 0 &&
        billingOffset <= 12
      ) {
        ccSettings = {
          closing_day: closingDay,
          confirmation_day: confirmationDay,
          withdrawal_day: withdrawalDay,
          billing_offset_months: billingOffset,
          withdrawal_account_id: values.withdrawal_account_id
            ? Number(values.withdrawal_account_id)
            : null,
        };
      }
    }

    try {
      await onSubmit(input, ccSettings);
      form.reset();
    } catch (err) {
      if (
        err instanceof ApiError &&
        err.status === 409 &&
        err.body?.error === "name_conflict"
      ) {
        form.setFieldError(
          "name",
          err.body?.conflict_type === "budget_category"
            ? t("nameConflictBudgetCategory")
            : t("nameConflictAccount"),
        );
      } else {
        throw err;
      }
    }
  }

  const baseCategoryOptions = CATEGORIES_BY_TYPE[selectedType] ?? [];
  const categoryOptions = baseCategoryOptions
    .filter((c) => !c.businessOwnerOnly || isBusinessOwner)
    .map((c) => ({ value: c.value, label: t(c.labelKey) }));
  const withdrawalAccountSelectOptions = withdrawalAccountOptions
    .filter(
      (account) =>
        account.type === "asset" && isUserSelectableAccount(account),
    )
    .map((account) => toAccountSelectOption(account, t));

  const totalRatio = form.values.budget_ratios.reduce(
    (sum, r) => sum + (Number(r.ratio) || 0),
    0,
  );

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={isEdit ? t("editAccountTitle") : t("addAccountTitle")}
      centered
    >
      <form onSubmit={form.onSubmit(handleSubmit)}>
        <Stack>
          <TextInput
            label={t("accountNameLabel")}
            placeholder={t("accountNamePlaceholder")}
            required
            {...form.getInputProps("name")}
          />
          <Select
            label={t("typeLabel")}
            required
            disabled={isEdit}
            data={[
              { value: "asset", label: t("typeAsset") },
              { value: "liability", label: t("typeLiability") },
              { value: "equity", label: t("typeEquity") },
              { value: "income", label: t("typeIncome") },
              { value: "expense", label: t("typeExpense") },
            ]}
            {...form.getInputProps("type")}
          />
          <Select
            label={t("categoryLabel")}
            required
            data={categoryOptions}
            {...form.getInputProps("category")}
          />
          {selectedType === "income" && (
            <NumberInput
              label={t("paydayLabel")}
              description={t("paydayHint")}
              placeholder="25"
              min={1}
              max={31}
              allowDecimal={false}
              value={form.values.payday}
              onChange={(v) => form.setFieldValue("payday", v)}
            />
          )}

          {selectedType === "asset" && (
            <Stack gap="xs">
              {form.values.category === "cash" && (
                <Checkbox
                  label={t("includeInAllocatableLabel")}
                  description={t("includeInAllocatableHint")}
                  checked={form.values.include_in_allocatable}
                  onChange={(e) =>
                    form.setFieldValue(
                      "include_in_allocatable",
                      e.currentTarget.checked,
                    )
                  }
                />
              )}
              <Checkbox
                label={t("isDepreciableLabel")}
                description={t("isDepreciableHint")}
                checked={form.values.is_depreciable}
                onChange={(e) =>
                  form.setFieldValue("is_depreciable", e.currentTarget.checked)
                }
              />
            </Stack>
          )}

          {selectedType === "liability" &&
            form.values.category === "credit_card" && (
              <>
                <Divider />
                <Stack gap="xs">
                  <Text size="sm" fw={500}>
                    {t("creditCardDatesLabel")}
                  </Text>
                  <Select
                    label={t("closingDayLabel")}
                    placeholder="-"
                    data={[
                      { value: "0", label: t("closingDayEndOfMonth") },
                      ...CLOSING_DAY_BASE_OPTIONS,
                    ]}
                    value={form.values.closing_day}
                    onChange={(v) => form.setFieldValue("closing_day", v)}
                    clearable
                  />
                  <NumberInput
                    label={t("confirmationDayLabel")}
                    placeholder="10"
                    min={1}
                    max={31}
                    allowDecimal={false}
                    value={form.values.confirmation_day}
                    onChange={(v) => form.setFieldValue("confirmation_day", v)}
                  />
                  <NumberInput
                    label={t("withdrawalDayLabel")}
                    placeholder="26"
                    min={1}
                    max={31}
                    allowDecimal={false}
                    value={form.values.withdrawal_day}
                    onChange={(v) => form.setFieldValue("withdrawal_day", v)}
                  />
                  <NumberInput
                    label={t("billingOffsetMonthsLabel")}
                    description={t("billingOffsetMonthsHint")}
                    min={0}
                    max={12}
                    allowDecimal={false}
                    value={form.values.billing_offset_months}
                    onChange={(v) =>
                      form.setFieldValue("billing_offset_months", v)
                    }
                  />
                  <Select
                    label={t("withdrawalAccountLabel")}
                    description={t("withdrawalAccountHint")}
                    placeholder={t("withdrawalAccountPlaceholder")}
                    data={withdrawalAccountSelectOptions}
                    renderOption={renderAccountOption as never}
                    value={form.values.withdrawal_account_id}
                    onChange={(v) =>
                      form.setFieldValue("withdrawal_account_id", v)
                    }
                    clearable
                    searchable
                  />
                </Stack>
              </>
            )}

          {selectedType === "expense" && budgetCategories.length > 0 && (
            <>
              <Divider />
              <Stack gap="xs">
                <Text size="sm" fw={500}>
                  {t("budgetDistributionLabel")}
                </Text>
                <Text size="xs" c="dimmed">
                  {t("budgetDistributionHint")}
                </Text>
                {budgetCategories.map((cat) => {
                  const ratioIdx = form.values.budget_ratios.findIndex(
                    (r) => r.budget_category_id === cat.id,
                  );
                  const fieldIdx =
                    ratioIdx >= 0 ? ratioIdx : budgetCategories.indexOf(cat);
                  return (
                    <Group key={cat.id} justify="space-between" align="center">
                      <Text size="sm" flex={1}>
                        {cat.name}
                      </Text>
                      <NumberInput
                        w={90}
                        min={0}
                        max={100}
                        suffix="%"
                        value={form.values.budget_ratios[fieldIdx]?.ratio ?? 0}
                        onChange={(v) =>
                          form.setFieldValue(
                            `budget_ratios.${fieldIdx}.ratio`,
                            v,
                          )
                        }
                      />
                    </Group>
                  );
                })}
                <Text
                  size="xs"
                  c={totalRatio > 100 ? "red" : "dimmed"}
                  ta="right"
                >
                  {t("budgetDistributionTotal")}: {totalRatio}%
                  {totalRatio > 100 && " !"}
                </Text>
              </Stack>
            </>
          )}

          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>
              {t("cancel")}
            </Button>
            <Button type="submit">
              {isEdit ? t("saveBudgetCategory") : t("addAccountTitle")}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
