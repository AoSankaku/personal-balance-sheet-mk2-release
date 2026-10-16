import { Anchor, Skeleton, Stack, Title } from "@mantine/core";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { BudgetCheckSection } from "../components/tt/BudgetCheckSection";
import { AppDataErrorAlert } from "../components/AppDataErrorAlert";
import { useAppData } from "../context/AppDataContext";
import { useLang } from "../i18n";

interface BudgetPageStateProps {
  loading: boolean;
  error: string | null;
  errorFallback: ReactNode;
  children: ReactNode;
}

export function BudgetPageState({
  loading,
  error,
  errorFallback,
  children,
}: BudgetPageStateProps) {
  if (loading) {
    return (
      <Stack gap="lg" role="status" aria-busy="true">
        <Skeleton height={24} width={120} radius="sm" />
        <Skeleton height={32} width={240} radius="sm" />
        <Skeleton height={140} radius="md" />
        <Skeleton height={220} radius="md" />
      </Stack>
    );
  }

  if (error) return errorFallback;

  return <>{children}</>;
}

export default function BudgetPage() {
  const { t } = useLang();
  const { loading, error } = useAppData();

  return (
    <BudgetPageState
      loading={loading}
      error={error}
      errorFallback={error ? <AppDataErrorAlert error={error} /> : null}
    >
      <Stack gap="lg">
        <Anchor component={Link} to="/fs" size="sm" c="dimmed">
          ← {t("navFS")}
        </Anchor>

        <Title order={3}>{t("budgetTitle")}</Title>

        <BudgetCheckSection />
      </Stack>
    </BudgetPageState>
  );
}
