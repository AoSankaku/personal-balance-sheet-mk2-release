import { Box, Group, Stack, Text, UnstyledButton } from "@mantine/core";
import {
  IconBook,
  IconLayoutDashboard,
  IconPencil,
  IconReportMoney,
  IconSettings,
} from "@tabler/icons-react";
import { NavLink } from "react-router-dom";
import { useLang } from "../i18n";
import type { TranslationKey } from "../i18n";

interface NavItem {
  to: string;
  icon: React.ReactNode;
  labelKey: TranslationKey;
  end?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  {
    to: "/",
    icon: <IconLayoutDashboard size={22} />,
    labelKey: "navOverview",
    end: true,
  },
  { to: "/input", icon: <IconPencil size={22} />, labelKey: "navInput" },
  { to: "/fs", icon: <IconReportMoney size={22} />, labelKey: "navFS" },
  { to: "/ledger", icon: <IconBook size={22} />, labelKey: "navLedger" },
  {
    to: "/settings",
    icon: <IconSettings size={22} />,
    labelKey: "navSettings",
  },
];

interface BottomNavProps {
  disableNavigation?: boolean;
}

export function BottomNav({ disableNavigation = false }: BottomNavProps) {
  const { t } = useLang();

  return (
    <Box>
      <Group grow h="100%" gap={0}>
        {NAV_ITEMS.map((item) =>
          disableNavigation ? (
            <UnstyledButton
              key={item.to}
              w="100%"
              py="xs"
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                color: "var(--mantine-color-dimmed)",
                opacity: 0.6,
                cursor: "not-allowed",
              }}
            >
              <Stack gap={2} align="center">
                {item.icon}
                <Text size="xs" fw={400}>
                  {t(item.labelKey)}
                </Text>
              </Stack>
            </UnstyledButton>
          ) : (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              style={{ textDecoration: "none" }}
            >
              {({ isActive }) => (
                <UnstyledButton
                  w="100%"
                  py="xs"
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    color: isActive
                      ? "var(--mantine-color-blue-6)"
                      : "var(--mantine-color-dimmed)",
                  }}
                >
                  <Stack gap={2} align="center">
                    {item.icon}
                    <Text size="xs" fw={isActive ? 600 : 400}>
                      {t(item.labelKey)}
                    </Text>
                  </Stack>
                </UnstyledButton>
              )}
            </NavLink>
          ),
        )}
      </Group>
    </Box>
  );
}
