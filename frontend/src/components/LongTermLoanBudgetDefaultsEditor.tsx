import {
  Alert,
  Button,
  Card,
  Group,
  NumberInput,
  Stack,
  Text,
} from "@mantine/core";
import { IconAlertTriangle, IconDeviceFloppy, IconRefresh } from "@tabler/icons-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { BudgetCategory, LongTermLoanBudgetWeight } from "@balance-sheet/shared";
import { api } from "../api/client";
import { useAppData } from "../context/AppDataContext";
import { useLang } from "../i18n";
import {
  normalizeLoanBudgetWeights,
  validateLoanBudgetWeights,
} from "../../../shared/longTermLoanBudgetDefaults";

type BudgetDefaults = Awaited<ReturnType<typeof api.loans.budgetDefaults.get>>;

interface Props {
  accountId: number;
  currency: string;
}

function normalizedForDisplay(rows: LongTermLoanBudgetWeight[]) {
  return rows.length > 0
    ? normalizeLoanBudgetWeights(rows)
    : [{ budget_category_id: null, weight: 1 }];
}

export function LongTermLoanBudgetDefaultsEditor({ accountId, currency }: Props) {
  const { t } = useLang();
  const { budgetCategories: activeBudgetCategories } = useAppData();
  const [retainedBudgetCategories, setRetainedBudgetCategories] = useState<BudgetCategory[]>([]);
  const [config, setConfig] = useState<BudgetDefaults | null>(null);
  const [weights, setWeights] = useState<LongTermLoanBudgetWeight[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void api.budget.listCategories({ includeArchived: true })
      .then((categories) => {
        if (!cancelled) setRetainedBudgetCategories(categories);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const next = await api.loans.budgetDefaults.get(accountId, currency);
      setConfig(next);
      setWeights(normalizedForDisplay(next.allocations));
      setHasChanges(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [accountId, currency]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    void api.loans.budgetDefaults.get(accountId, currency)
      .then((next) => {
        if (cancelled) return;
        setConfig(next);
        setWeights(normalizedForDisplay(next.allocations));
        setHasChanges(false);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [accountId, currency]);

  const allRows = useMemo(() => {
    const byId = new Map(weights.map((row) => [row.budget_category_id, row.weight]));
    const categoriesById = new Map<number, BudgetCategory>();
    for (const category of [...activeBudgetCategories, ...retainedBudgetCategories]) {
      categoriesById.set(category.id, category);
    }
    return [
      ...[...categoriesById.values()].map((category) => ({
        budget_category_id: category.id,
        name: category.name,
        weight: byId.get(category.id) ?? 0,
        is_archived: category.is_archived ?? false,
      })),
      ...weights
        .filter((row) => row.budget_category_id != null && !categoriesById.has(row.budget_category_id))
        .map((row) => ({
          budget_category_id: row.budget_category_id,
          name: `${t("unknownCategoryPrefix")}${row.budget_category_id}`,
          weight: row.weight,
          is_archived: true,
        })),
      {
        budget_category_id: null,
        name: t("loanFundingUnallocated"),
        weight: byId.get(null) ?? 0,
        is_archived: false,
      },
    ];
  }, [activeBudgetCategories, retainedBudgetCategories, t, weights]);
  const weightTotal = allRows.reduce((sum, row) => sum + row.weight, 0);

  function updateWeight(categoryId: number | null, value: number | string) {
    const numeric = Number(value);
    const weight = Number.isSafeInteger(numeric) && numeric > 0 ? numeric : 0;
    setWeights((current) => [
      ...current.filter((row) => row.budget_category_id !== categoryId),
      ...(weight > 0 ? [{ budget_category_id: categoryId, weight }] : []),
    ].sort((left, right) => {
      if (left.budget_category_id === null) return right.budget_category_id === null ? 0 : 1;
      if (right.budget_category_id === null) return -1;
      return left.budget_category_id - right.budget_category_id;
    }));
    setHasChanges(true);
  }

  async function save() {
    const allocations = weights.filter((row) => row.weight > 0);
    if (validateLoanBudgetWeights(allocations)) return;
    setSaving(true);
    setError(false);
    try {
      await api.loans.budgetDefaults.update(accountId, {
        currency,
        allocations,
      });
      await load();
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  }

  async function reset() {
    setSaving(true);
    setError(false);
    try {
      await api.loans.budgetDefaults.reset(accountId, currency);
      await load();
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card
      component="section"
      aria-label={t("loanBudgetDefaultsTitle")}
      withBorder
      radius="md"
      p="lg"
    >
      <Stack gap="sm">
        <div>
          <Text fw={700}>{t("loanBudgetDefaultsTitle")}</Text>
          <Text size="sm" c="dimmed">{t("loanBudgetDefaultsHint")}</Text>
        </div>
        {config?.source === "unavailable" && (
          <Alert icon={<IconAlertTriangle size={16} />} color="yellow">
            {t("loanBudgetDefaultsUnavailable")}
          </Alert>
        )}
        {error && (
          <Alert icon={<IconAlertTriangle size={16} />} color="red">
            <Group justify="space-between">
              <Text size="sm">{t("loanBudgetDefaultsLoadError")}</Text>
              <Button size="xs" variant="light" loading={loading} onClick={() => void load()}>
                {t("reload")}
              </Button>
            </Group>
          </Alert>
        )}
        <Text size="xs" c="dimmed">
          {t("loanBudgetDefaultsSourceLabel")}: {config?.source === "custom"
            ? t("loanBudgetDefaultsSource_custom")
            : config?.source === "unavailable"
              ? t("loanBudgetDefaultsSource_unavailable")
              : t("loanBudgetDefaultsSource_opening")} ({currency})
        </Text>
        <Text size="xs" c="dimmed">{t("loanBudgetDefaultsRatioExample")}</Text>
        {allRows.map((row) => (
          <Group key={row.budget_category_id ?? "unallocated"} justify="space-between" gap="sm">
            <Group gap="xs" flex={1}>
              <Text size="sm">{row.name}</Text>
              {row.is_archived && (
                <Text size="xs" c="dimmed">{t("archivedBudgetCategoryBadge")}</Text>
              )}
            </Group>
            <NumberInput
              aria-label={row.name}
              label={t("loanBudgetDefaultsWeightLabel")}
              w={145}
              min={0}
              step={1}
              decimalScale={0}
              allowDecimal={false}
              thousandSeparator=","
              value={row.weight}
              disabled={loading || saving || error}
              onChange={(value) => updateWeight(row.budget_category_id, value)}
            />
            <Text size="xs" c="dimmed" w={68} ta="right">
              {weightTotal > 0
                ? `${((row.weight / weightTotal) * 100).toFixed(1)}%`
                : "0.0%"}
            </Text>
          </Group>
        ))}
        <Group justify="flex-end">
          <Button
            variant="subtle"
            leftSection={<IconRefresh size={14} />}
            onClick={() => void reset()}
            disabled={loading || saving || error || config?.source !== "custom"}
          >
            {t("loanBudgetDefaultsReset")}
          </Button>
          <Button
            leftSection={<IconDeviceFloppy size={14} />}
            onClick={() => void save()}
            loading={saving}
            disabled={loading || error || !hasChanges || weightTotal <= 0 || Boolean(validateLoanBudgetWeights(weights.filter((row) => row.weight > 0)))}
          >
            {t("loanBudgetDefaultsSave")}
          </Button>
        </Group>
      </Stack>
    </Card>
  );
}
