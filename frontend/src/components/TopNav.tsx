import {
  ActionIcon,
  Anchor,
  Box,
  Group,
  Indicator,
  Popover,
  Select,
  Stack,
  Text,
  ThemeIcon,
  Title,
  UnstyledButton,
  useComputedColorScheme,
} from "@mantine/core";
import {
  IconBook,
  IconChevronRight,
  IconLayoutDashboard,
  IconListCheck,
  IconPencil,
  IconReportMoney,
  IconSettings,
  IconWifiOff,
} from "@tabler/icons-react";
import { useMediaQuery } from "@mantine/hooks";
import { useEffect, useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { VERSION } from "../lib/version";
import { useAppData } from "../context/AppDataContext";
import { useLang } from "../i18n";
import type { CryptoIconStyle } from "../lib/cryptoCurrencyIcons";
import { getEffectiveSymbol } from "../lib/currencyUtils";
import { CurrencyOptionIcon } from "./CurrencyOptionIcon";
import { useOnlineStatus } from "../hooks/useOnlineStatus";
import { useTaskCollection } from "../hooks/useTaskCollection";
import { TaskList } from "./TaskList";
import "./TopNav.css";

const HEADER_ACTION_ICON_SIZE = "md";

function TaskMenu({ disabled = false }: { disabled?: boolean }) {
  const { t } = useLang();
  const navigate = useNavigate();
  const [opened, setOpened] = useState(false);
  const tasks = useTaskCollection();
  const { totalCount } = tasks;
  const effectiveCount = disabled ? 0 : totalCount;
  const taskCountLabel = t("taskMenuCount").replace(
    "{count}",
    String(effectiveCount),
  );

  useEffect(() => {
    if (disabled) setOpened(false);
  }, [disabled]);

  return (
    <>
      {opened && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 199,
          }}
          onClick={() => setOpened(false)}
        />
      )}
      <Popover
        opened={opened}
        onClose={() => setOpened(false)}
        position="bottom-end"
        withArrow
        shadow="md"
        withinPortal
        zIndex={200}
      >
        <Popover.Target>
          <Indicator
            disabled={effectiveCount === 0}
            color="red"
            size={16}
            label={effectiveCount > 0 ? String(effectiveCount) : undefined}
            offset={4}
            styles={{ indicator: { pointerEvents: "none" } }}
          >
            <ActionIcon
              variant="default"
              size={HEADER_ACTION_ICON_SIZE}
              disabled={disabled}
              onClick={() => {
                if (disabled) return;
                setOpened((o) => !o);
              }}
              aria-label={`${t("taskMenuTitle")}: ${taskCountLabel}`}
              aria-expanded={opened}
              aria-haspopup="dialog"
              title={t("tasks")}
            >
              <IconListCheck size={18} aria-hidden="true" />
            </ActionIcon>
          </Indicator>
        </Popover.Target>

        <Popover.Dropdown
          p={0}
          role="dialog"
          aria-label={t("taskMenuTitle")}
          className="task-menu__dropdown"
        >
          <UnstyledButton
            className="task-menu__header"
            onClick={() => {
              navigate("/tasks");
              setOpened(false);
            }}
            aria-label={`${t("taskMenuTitle")}: ${taskCountLabel}`}
          >
            <Group justify="space-between" wrap="nowrap">
              <Group gap="sm" wrap="nowrap">
                <ThemeIcon variant="light" color="blue" radius="xl" size={34}>
                  <IconListCheck size={18} aria-hidden="true" />
                </ThemeIcon>
                <Box>
                  <Text fw={700} size="sm">
                    {t("taskMenuTitle")}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {taskCountLabel}
                  </Text>
                </Box>
              </Group>
              <IconChevronRight size={18} aria-hidden="true" />
            </Group>
          </UnstyledButton>
          <Box className="task-menu__content">
            <TaskList tasks={tasks} onNavigate={() => setOpened(false)} />
          </Box>
        </Popover.Dropdown>
      </Popover>
    </>
  );
}

function CompactCurrencyMenu({
  options,
  displayCurrency,
  cryptoIconStyle,
  onSelect,
}: {
  options: {
    value: string;
    backgroundColor?: string | null;
    customIcon?: string | null;
    symbol?: string;
  }[];
  displayCurrency: string;
  cryptoIconStyle: CryptoIconStyle;
  onSelect: (value: string) => void;
}) {
  const { t } = useLang();
  const [opened, setOpened] = useState(false);
  const selectedOption = options.find((c) => c.value === displayCurrency);

  return (
    <>
      {opened && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 199 }}
          onClick={() => setOpened(false)}
        />
      )}
      <style>{`
        .compact-currency-option {
          cursor: pointer;
          border-radius: 4px;
        }
        .compact-currency-option:hover {
          background: light-dark(var(--mantine-color-gray-1), var(--mantine-color-dark-5));
        }
      `}</style>
      <Popover
        opened={opened}
        onClose={() => setOpened(false)}
        position="bottom-end"
        withArrow
        shadow="md"
        withinPortal
        zIndex={200}
      >
        <Popover.Target>
          <ActionIcon
            variant="default"
            size={HEADER_ACTION_ICON_SIZE}
            aria-label={t("displayCurrencyLabel")}
            title={t("displayCurrencyLabel")}
            onClick={() => setOpened((o) => !o)}
          >
            <CurrencyOptionIcon
              backgroundColor={selectedOption?.backgroundColor}
              code={displayCurrency}
              cryptoIconStyle={cryptoIconStyle}
              size={20}
              symbol={selectedOption?.symbol}
              customIcon={selectedOption?.customIcon}
            />
          </ActionIcon>
        </Popover.Target>
        <Popover.Dropdown p="xs" miw={120}>
          <Stack gap={2}>
            {options.map((opt) => (
              <UnstyledButton
                key={opt.value}
                px={6}
                py={6}
                className="compact-currency-option"
                onClick={() => {
                  onSelect(opt.value);
                  setOpened(false);
                }}
              >
                <Group gap={8} wrap="nowrap">
                  <CurrencyOptionIcon
                    backgroundColor={opt.backgroundColor}
                    code={opt.value}
                    cryptoIconStyle={cryptoIconStyle}
                    size={20}
                    symbol={opt.symbol}
                    customIcon={opt.customIcon}
                  />
                  <Text size="sm">{opt.value}</Text>
                </Group>
              </UnstyledButton>
            ))}
          </Stack>
        </Popover.Dropdown>
      </Popover>
    </>
  );
}

function CurrencySwitcher() {
  const {
    enabledCurrencies,
    displayCurrency,
    setDisplayCurrency,
    cryptoIconStyle,
  } = useAppData();
  const isCompact = useMediaQuery("(max-width: 500px)");

  if (enabledCurrencies.length <= 1) return null;

  const options = enabledCurrencies.map((c) => ({
    value: c.code,
    label: c.code,
    backgroundColor: c.background_color,
    customIcon: c.custom_icon,
    symbol: getEffectiveSymbol(c.code, enabledCurrencies),
  }));
  const selectedOption = options.find((c) => c.value === displayCurrency);

  if (isCompact) {
    return (
      <CompactCurrencyMenu
        options={options}
        displayCurrency={displayCurrency}
        cryptoIconStyle={cryptoIconStyle}
        onSelect={(v) => setDisplayCurrency(v)}
      />
    );
  }

  return (
    <Select
      size="xs"
      w={112}
      value={displayCurrency}
      onChange={(v) => v && setDisplayCurrency(v)}
      data={options}
      allowDeselect={false}
      leftSection={
        <CurrencyOptionIcon
          backgroundColor={selectedOption?.backgroundColor}
          code={displayCurrency}
          cryptoIconStyle={cryptoIconStyle}
          symbol={selectedOption?.symbol}
          customIcon={selectedOption?.customIcon}
        />
      }
      leftSectionPointerEvents="none"
      renderOption={({ option }) => (
        <Group gap={8} wrap="nowrap">
          <CurrencyOptionIcon
            backgroundColor={
              options.find((currency) => currency.value === option.value)
                ?.backgroundColor
            }
            code={option.value}
            cryptoIconStyle={cryptoIconStyle}
            symbol={
              options.find((currency) => currency.value === option.value)
                ?.symbol
            }
            customIcon={
              options.find((currency) => currency.value === option.value)
                ?.customIcon
            }
          />
          <Text size="sm">{option.label}</Text>
        </Group>
      )}
      checkIconPosition="right"
      comboboxProps={{ withinPortal: true }}
    />
  );
}

interface NavLinkItem {
  to: string;
  label: string;
  icon: React.ReactNode;
  end?: boolean;
}

interface TopNavProps {
  disableNavigation?: boolean;
  disableTasks?: boolean;
}

export function TopNav({
  disableNavigation = false,
  disableTasks = false,
}: TopNavProps) {
  const { t } = useLang();
  const computed = useComputedColorScheme("light");
  const isOnline = useOnlineStatus();

  const navItems: NavLinkItem[] = [
    {
      to: "/",
      icon: <IconLayoutDashboard size={14} />,
      label: t("navOverview"),
      end: true,
    },
    { to: "/input", icon: <IconPencil size={14} />, label: t("navInput") },
    { to: "/fs", icon: <IconReportMoney size={14} />, label: t("navFS") },
    { to: "/ledger", icon: <IconBook size={14} />, label: t("navLedger") },
    {
      to: "/settings",
      icon: <IconSettings size={14} />,
      label: t("navSettings"),
    },
  ];

  return (
    <Group h="100%" px="sm" justify="space-between">
      <Group gap="sm">
        <style>{`
          .title-version-row {
            display: flex;
            flex-direction: row;
            align-items: flex-end;
            gap: 10px;
          }
          @media (max-width: 1100px) {
            .title-version-row {
              flex-direction: column;
              align-items: flex-start;
              gap: 0;
            }
          }
        `}</style>
        <div className="title-version-row">
          <Group gap={5} wrap="nowrap">
            {!isOnline && (
              <ThemeIcon
                color="yellow"
                variant="light"
                radius="xl"
                size="sm"
                aria-label={t("offlineModeLabel")}
                title={t("offlineModeLabel")}
              >
                <IconWifiOff size={14} aria-hidden="true" />
              </ThemeIcon>
            )}
            <Title
              order={4}
              style={{
                fontSize: "clamp(0.7rem, 4vw, var(--mantine-h4-font-size))",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {t("appTitle")}
            </Title>
          </Group>
          <Text size="xs" c="dimmed" style={{ whiteSpace: "nowrap" }}>
            v{VERSION}
          </Text>
        </div>
        {/* Desktop nav links */}
        <Group gap="md" visibleFrom="md">
          {navItems.map((item) =>
            disableNavigation ? (
              <Anchor
                key={item.to}
                component="span"
                size="sm"
                fw={400}
                c={computed === "dark" ? "gray.3" : "dimmed"}
                style={{ opacity: 0.6, cursor: "not-allowed" }}
              >
                <Group gap={4} align="center" wrap="nowrap">
                  {item.icon}
                  {item.label}
                </Group>
              </Anchor>
            ) : (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                style={{ textDecoration: "none" }}
              >
                {({ isActive }) => (
                  <Anchor
                    component="span"
                    size="sm"
                    fw={isActive ? 700 : 400}
                    c={
                      isActive
                        ? computed === "dark"
                          ? "blue.4"
                          : "blue"
                        : computed === "dark"
                          ? "gray.3"
                          : "dimmed"
                    }
                  >
                    <Group gap={4} align="center" wrap="nowrap">
                      {item.icon}
                      {item.label}
                    </Group>
                  </Anchor>
                )}
              </NavLink>
            ),
          )}
        </Group>
      </Group>
      <Group gap="xs">
        <CurrencySwitcher />
        <TaskMenu disabled={disableTasks} />
      </Group>
    </Group>
  );
}
