import { Anchor, Stack, Title } from "@mantine/core";
import { Link } from "react-router-dom";
import { BudgetCheckSection } from "../components/tt/BudgetCheckSection";
import { useLang } from "../i18n";

export default function BudgetPage() {
  const { t } = useLang();

  return (
    <Stack gap="lg">
      <Anchor component={Link} to="/fs" size="sm" c="dimmed">
        ← {t("navFS")}
      </Anchor>

      <Title order={3}>{t("budgetTitle")}</Title>

      <BudgetCheckSection />
    </Stack>
  );
}
