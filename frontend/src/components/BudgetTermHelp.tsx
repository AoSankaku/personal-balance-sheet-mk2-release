import { ActionIcon, Stack, Text, Tooltip } from "@mantine/core";
import { IconHelpCircle } from "@tabler/icons-react";
import { Link } from "react-router-dom";
import { useLang } from "../i18n";
import { budgetGuideLink, budgetTermHelp, type BudgetHelpTerm } from "../lib/budgetHelp";

export function BudgetTermHelp({ term }: { term: BudgetHelpTerm }) {
  const { t } = useLang();
  const [hint, anchor] = budgetTermHelp[term];
  return (
    <Tooltip
      label={
        <Stack gap={4}>
          <Text size="xs">{t(hint)}</Text>
          <Text size="xs" fw={600}>{t("budgetHelpOpenGuide")}</Text>
        </Stack>
      }
      multiline
      w={300}
      withArrow
      events={{ hover: true, focus: true, touch: false }}
    >
      <ActionIcon
        component={Link}
        to={budgetGuideLink(anchor)}
        variant="subtle"
        color="gray"
        size="sm"
        aria-label={t("budgetHelpGuideLabel").replace("{term}", t(term))}
        style={{ verticalAlign: "middle", flexShrink: 0 }}
      >
        <IconHelpCircle size={16} aria-hidden="true" />
      </ActionIcon>
    </Tooltip>
  );
}
