import {
  Button,
  Group,
  Modal,
  MultiSelect,
  NumberInput,
  Select,
  Stack,
  TextInput,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { useEffect } from "react";
import type { BudgetCategory } from "@balance-sheet/shared";
import { api, ApiError } from "../api/client";
import { useLang } from "../i18n";
import { useAppData } from "../context/AppDataContext";
import {
  isUserSelectableAccount,
  toAccountSelectOption,
} from "../lib/accountUtils";

interface Props {
  opened: boolean;
  onClose: () => void;
  onSaved: () => void;
  category?: BudgetCategory;
  budgetCategories?: BudgetCategory[];
  currentYearMonth: string;
}

interface FormValues {
  name: string;
  budget_group: string;
  goal_balance: number | "";
  balance_cap: number | "";
  overflow_budget_category_id: string | null;
  target_account_ids: string[];
}

export function BudgetCategoryModal({
  opened,
  onClose,
  onSaved,
  category,
  budgetCategories = [],
}: Props) {
  const { t, locale } = useLang();
  const { accounts } = useAppData();
  const isEdit = Boolean(category);

  const form = useForm<FormValues>({
    initialValues: {
      name: "",
      budget_group: "日常支出",
      goal_balance: "",
      balance_cap: "",
      overflow_budget_category_id: null,
      target_account_ids: [],
    },
    validate: {
      name: (v) => (v.trim().length === 0 ? t("nameIsRequired") : null),
    },
  });

  useEffect(() => {
    if (category) {
      form.setValues({
        name: category.name,
        budget_group: category.budget_group,
        goal_balance: category.goal_balance ?? "",
        balance_cap: category.balance_cap ?? "",
        overflow_budget_category_id:
          category.overflow_budget_category_id != null
            ? String(category.overflow_budget_category_id)
            : null,
        target_account_ids: (category.target_accounts ?? []).map((target) =>
          String(target.account_id),
        ),
      });
    } else {
      form.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category, opened]);

  async function handleSubmit(values: FormValues) {
    const goal_balance =
      values.goal_balance === "" ? null : values.goal_balance;
    const balance_cap = values.balance_cap === "" ? null : values.balance_cap;
    const overflow_budget_category_id =
      values.overflow_budget_category_id != null
        ? Number(values.overflow_budget_category_id)
        : null;
    const target_accounts = values.target_account_ids.map((accountId) => {
      return {
        account_id: Number(accountId),
        ratio: 100,
      };
    });

    try {
      if (isEdit && category) {
        await api.budget.updateCategory(category.id, {
          name: values.name,
          rollover_months: -1,
          budget_group: values.budget_group,
          goal_balance,
          balance_cap,
          overflow_budget_category_id,
          target_accounts,
        });
      } else {
        await api.budget.createCategory({
          name: values.name,
          rollover_months: -1,
          budget_group: values.budget_group,
          goal_balance,
          balance_cap,
          overflow_budget_category_id,
          target_accounts,
        });
      }
    } catch (err) {
      if (
        err instanceof ApiError &&
        err.status === 409 &&
        err.body?.error === "name_conflict"
      ) {
        form.setFieldError(
          "name",
          err.body?.conflict_type === "account"
            ? t("nameConflictAccount")
            : t("nameConflictBudgetCategory"),
        );
        return;
      }
      throw err;
    }

    onSaved();
    onClose();
    form.reset();
  }

  function handleClose() {
    form.reset();
    onClose();
  }

  const overflowOptions = budgetCategories
    .filter((cat) => cat.id !== category?.id)
    .map((cat) => ({ value: String(cat.id), label: cat.name }));
  const targetAccountOptions = accounts
    .filter(
      (account) =>
        account.type === "asset" &&
        !account.is_depreciable &&
        account.include_in_allocatable !== false &&
        account.category === "cash" &&
        isUserSelectableAccount(account),
    )
    .map((account) => toAccountSelectOption(account, t));

  function handleTargetAccountIdsChange(values: string[]) {
    form.setFieldValue("target_account_ids", values);
  }

  return (
    <Modal
      opened={opened}
      onClose={handleClose}
      title={isEdit ? t("editBudgetCategory") : t("addBudgetCategory")}
      centered
    >
      <form onSubmit={form.onSubmit(handleSubmit)}>
        <Stack>
          <TextInput
            label={t("budgetCategoryName")}
            required
            {...form.getInputProps("name")}
          />
          <Select
            label={t("budgetGroupLabel")}
            data={[
              { value: "日常支出", label: t("budgetGroupDaily") },
              { value: "貯蓄", label: t("budgetGroupSavings") },
            ]}
            {...form.getInputProps("budget_group")}
          />
          <NumberInput
            label={t("goalBalanceLabel")}
            description={t("goalBalanceDesc")}
            min={0}
            prefix="¥"
            thousandSeparator=","
            allowDecimal={false}
            placeholder={t("optional")}
            {...form.getInputProps("goal_balance")}
          />
          <NumberInput
            label={t("budgetBalanceCapLabel")}
            description={t("budgetBalanceCapDesc")}
            min={0}
            prefix="¥"
            thousandSeparator=","
            allowDecimal={false}
            placeholder={t("optional")}
            {...form.getInputProps("balance_cap")}
          />
          <Select
            label={t("budgetOverflowTargetLabel")}
            placeholder={t("budgetOverflowTargetPlaceholder")}
            data={overflowOptions}
            clearable
            disabled={form.values.balance_cap === ""}
            {...form.getInputProps("overflow_budget_category_id")}
          />
          <MultiSelect
            label={t("budgetTargetAccountsLabel")}
            description={
              locale === "ja"
                ? "予算配置の目安です。紐づいた予算と口座はグループ化し、合計残高で比較します。"
                : t("budgetTargetAccountsDesc")
            }
            data={targetAccountOptions}
            value={form.values.target_account_ids}
            onChange={handleTargetAccountIdsChange}
            searchable
            clearable
          />

          <Group justify="flex-end">
            <Button variant="default" onClick={handleClose}>
              {t("cancel")}
            </Button>
            <Button type="submit">{t("saveBudgetCategory")}</Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
