import { Stack, Text } from "@mantine/core";
import { useLang } from "../i18n";
import { formatCurrency } from "../lib/numberFormat";
import type { BudgetUsagePresentation } from "../lib/budgetUsagePresentation";

export function BudgetUsageDetails({ usage, locale, currency }: {
  usage: BudgetUsagePresentation;
  locale: string;
  currency: string;
}) {
  const { t } = useLang();
  if (usage.fundingOut === 0 && usage.fundingIn === 0 && usage.reference === 0) return null;
  return (
    <Stack gap={2} mt={4} data-testid="budget-usage-details">
      {usage.fundingOut !== 0 && (
        <>
          <Text size="xs" c="dimmed" data-testid="budget-spending-usage">
            {t("budgetSpendingUsageLabel")}: {formatCurrency(usage.spending, locale, currency)}
          </Text>
          <Text size="xs" data-testid="budget-monthly-funding-out">
            {t("budgetMonthlyFundingOutLabel")}: {formatCurrency(usage.fundingOut, locale, currency)}
          </Text>
        </>
      )}
      {usage.fundingIn !== 0 && (
        <Text size="xs" c="dimmed" data-testid="budget-monthly-funding-in">
          {t("budgetMonthlyFundingInLabel")}: {formatCurrency(usage.fundingIn, locale, currency)}
        </Text>
      )}
      {usage.reference !== 0 && (
        <Text size="xs" c="blue" data-testid="budget-reference-record">
          {t("budgetReferenceSpentLabel")}: {formatCurrency(usage.reference, locale, currency)}
        </Text>
      )}
    </Stack>
  );
}
