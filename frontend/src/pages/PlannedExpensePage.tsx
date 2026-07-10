import {
  ActionIcon,
  Accordion,
  Anchor,
  Badge,
  Box,
  Button,
  Center,
  Checkbox,
  Divider,
  Group,
  Image,
  Menu,
  Modal,
  MultiSelect,
  NumberInput,
  Paper,
  Select,
  SimpleGrid,
  Skeleton,
  Stack,
  Switch,
  Text,
  TextInput,
  Textarea,
  ThemeIcon,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import { DatePickerInput } from "@mantine/dates";
import { useForm } from "@mantine/form";
import { useMediaQuery } from "@mantine/hooks";
import {
  IconArrowLeft,
  IconArrowDown,
  IconArrowUp,
  IconAlertTriangle,
  IconCalendarDollar,
  IconCheck,
  IconChevronLeft,
  IconChevronRight,
  IconDotsVertical,
  IconEdit,
  IconGift,
  IconGripVertical,
  IconPlayerTrackNext,
  IconPlus,
  IconRefresh,
  IconReceipt,
  IconShoppingCart,
  IconStarFilled,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import dayjs from "dayjs";
import type { ChangeEvent, DragEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type {
  PlannedExpense,
  PlannedExpenseCategory,
  PlannedExpenseKind,
  PlannedExpenseMonthlyMode,
  PlannedExpenseRecurrenceType,
  PlannedExpenseRecurrenceUnit,
  PlannedExpenseStatus,
  PlannedExpenseWeekFallback,
  ProductAvailabilityStatus,
  ProductMetadata,
  ShoppingPlanType,
} from "@balance-sheet/shared";
import {
  hasDuplicatePlannedExpenseCategoryName,
  hasDuplicatePlannedExpenseItemName,
  resolvePlannedExpenseWeekdayRuleDate,
} from "@balance-sheet/shared";
import { ApiError, api } from "../api/client";
import { useAppData } from "../context/AppDataContext";
import { useLang } from "../i18n";
import { formatCompactCurrency, formatCurrency } from "../lib/numberFormat";
import {
  buildPlannedExpenseInputOverride,
  categoriesForPlannedExpenseCurrency,
  plannedExpenseReferenceAmount,
  preservePlannedExpensesAcrossCurrencies,
} from "../lib/plannedExpenseCurrency";
import { accountDisplayName } from "../lib/accountUtils";
import {
  buildAccountOptions,
  renderAccountOption,
} from "../lib/accountSelect";
import type { PlannedExpenseEntrySource } from "../types/plannedExpenseInput";
import { ConfirmModal } from "../components/ConfirmModal";
import {
  moveById,
  moveByStep,
  sortByManualOrder,
  type DropPosition,
  type MoveDirection,
  withSequentialSortOrder,
} from "../lib/plannedExpenseOrdering";
import {
  plannedExpenseActionRequiresConfirmation,
  plannedExpenseDayOfMonthSelectOptions,
  plannedExpenseMonthlyDueDateFromDay,
  plannedExpenseCompletedScheduledGroups,
  type PlannedExpenseCompletedScheduledGroup,
  plannedExpenseApplyScheduledSkipPolicy,
  plannedExpenseHasFixedRecurrenceEnd,
  plannedExpenseRecurrenceFinalOccurrenceDate,
  plannedExpenseRecurrencePlannedCount,
  type PlannedExpenseSkipPolicy,
  mergePlannedExpenseListsById,
  plannedExpenseItemNameLineClamp,
  plannedExpenseCategorySelectValue,
  parsePlannedExpenseWeeksOfMonth,
  serializePlannedExpenseWeeksOfMonth,
  shouldShowCompletedWishlistAmountTotal,
  shouldShowWishlistItemInCompletedList,
  shouldShowWishlistItemInMainList,
  shouldShowPlannedExpenseStatusField,
} from "../lib/plannedExpenseForm";
import {
  calendarGridLayout,
  calendarWeekdayColor,
  calendarWeekdayKeys,
  isCalendarToday,
  normalizeCalendarWeekStart,
  startOfCalendarWeek,
} from "../lib/calendarWeekStart";
import {
  plannedExpenseCalendarDayBackground,
  plannedExpenseCalendarDayHasCompleted,
  plannedExpenseCalendarDayHasSkipped,
  plannedExpenseCalendarEntryAmount,
  plannedExpenseCalendarOccurrences,
  plannedExpenseCalendarShouldShowStatus,
  plannedExpenseCompleteOccurrenceUpdates,
  plannedExpenseCompletedDateList,
  plannedExpenseRemoveCompletedDate,
  plannedExpenseRemoveSkippedDate,
  plannedExpenseSkippedDateList,
  type PlannedExpenseCalendarOccurrence,
} from "../lib/plannedExpenseCalendar";

type PlannedExpensePageProps = {
  kind: PlannedExpenseKind;
};

type PlannedExpenseFormValues = {
  category_id: string | null;
  name: string;
  estimated_amount: number | "";
  currency: string;
  expense_account_id: string | null;
  target_date: Date | null;
  recurrence_type: PlannedExpenseRecurrenceType;
  recurrence_interval: number | "";
  recurrence_unit: PlannedExpenseRecurrenceUnit;
  recurrence_monthly_mode: PlannedExpenseMonthlyMode;
  recurrence_day: string | null;
  recurrence_weeks_of_month: string[];
  recurrence_weekday: string | null;
  recurrence_week_fallback: PlannedExpenseWeekFallback;
  next_due_date: Date | null;
  recurrence_end_mode: PlannedExpenseRecurrenceEndMode;
  end_date: Date | null;
  recurrence_count: number | "";
  status: PlannedExpenseStatus;
  keep_on_routine_clear: boolean;
  note: string;
  url: string;
  product_metadata_cache_id: number | null;
};

type PlannedExpenseRecurrenceEndMode = "date" | "count";

type CategoryFormValues = {
  name: string;
  estimated_amount: number | "";
  currency: string;
  default_expense_account_id: string | null;
  target_date: Date | null;
  shopping_plan_type: ShoppingPlanType;
};

type InlineShoppingItemDraft = {
  categoryId: number;
  name: string;
  keepOnRoutineClear: boolean;
  saving: boolean;
  error: string | null;
};

type CalendarDayEntry = PlannedExpenseCalendarOccurrence & {
  item: PlannedExpense;
  skipped: boolean;
  completed: boolean;
};

type SelectedCalendarDay = {
  date: string;
  entries: CalendarDayEntry[];
};

type Translate = ReturnType<typeof useLang>["t"];
type ConvertCurrency = (amount: number, from: string, to: string) => number;

type ShoppingPlanGroup = {
  category: PlannedExpenseCategory | null;
  id: number | null;
  name: string;
  items: PlannedExpense[];
};

function ReferenceAmount({
  amount,
  sourceCurrency,
  selectedCurrency,
  convertCurrency,
  locale,
  t,
}: {
  amount: number;
  sourceCurrency: string;
  selectedCurrency: string;
  convertCurrency: ConvertCurrency;
  locale: string;
  t: Translate;
}) {
  const referenceAmount = plannedExpenseReferenceAmount(
    amount,
    sourceCurrency,
    selectedCurrency,
    convertCurrency,
  );
  if (referenceAmount === null) return null;
  return (
    <Text size="xs" c="dimmed">
      {t("plannedExpenseReferenceAmount")}: {" "}
      {formatCurrency(referenceAmount, locale, selectedCurrency)}
    </Text>
  );
}

type UndatedShoppingPlanPosition = "first" | "last";

type BudgetDistributionPreviewRow = {
  key: string;
  name: string;
  amount: number;
  ratio: number;
  isUnallocated?: boolean;
};

type WishlistDragState =
  | { type: "category"; id: number }
  | { type: "item"; id: number; categoryId: number | null };

const statusRank: Record<PlannedExpenseStatus, number> = {
  open: 0,
  completed: 1,
  cancelled: 2,
};
const SHOPPING_PLAN_UNDATED_POSITION_STORAGE_KEY =
  "plannedExpenses:shoppingPlanUndatedPosition";

function readUndatedShoppingPlanPosition(): UndatedShoppingPlanPosition {
  try {
    const value = localStorage.getItem(
      SHOPPING_PLAN_UNDATED_POSITION_STORAGE_KEY,
    );
    return value === "first" || value === "last" ? value : "last";
  } catch {
    return "last";
  }
}

function persistUndatedShoppingPlanPosition(
  value: UndatedShoppingPlanPosition,
) {
  try {
    localStorage.setItem(SHOPPING_PLAN_UNDATED_POSITION_STORAGE_KEY, value);
  } catch {
    // localStorage can be unavailable in private browsing or tests.
  }
}

function dateToInputDate(value: string | null): Date | null {
  return value ? new Date(`${value}T00:00:00`) : null;
}

function inputDateToString(value: Date | null): string | null {
  return value ? dayjs(value).format("YYYY-MM-DD") : null;
}

function availabilityColor(status: ProductAvailabilityStatus) {
  if (status === "in_stock") return "teal";
  if (status === "out_of_stock" || status === "unavailable") return "red";
  if (status === "api_credentials_missing" || status === "unsupported") {
    return "yellow";
  }
  if (status === "error") return "orange";
  return "gray";
}

function getDropPosition(event: DragEvent<HTMLElement>): DropPosition {
  const rect = event.currentTarget.getBoundingClientRect();
  return event.clientY > rect.top + rect.height / 2 ? "after" : "before";
}

function isSupportedProductUrl(value: string) {
  try {
    const url = new URL(value.trim());
    const hostname = url.hostname.toLowerCase();
    return (
      hostname === "amazon.co.jp" ||
      hostname === "www.amazon.co.jp" ||
      hostname === "amzn.asia" ||
      hostname === "item.rakuten.co.jp" ||
      hostname === "books.rakuten.co.jp" ||
      hostname === "hb.afl.rakuten.co.jp" ||
      hostname === "shopping.yahoo.co.jp" ||
      hostname === "store.shopping.yahoo.co.jp"
    );
  } catch {
    return false;
  }
}

function dueDateForItem(item: PlannedExpense) {
  if (item.kind === "shopping_list") return item.category_target_date;
  return item.recurrence_type === "recurring"
    ? item.next_due_date
    : item.target_date;
}

function recurrenceUnitLabel(
  item: PlannedExpense,
  t: Translate,
): string {
  const unit = item.recurrence_unit ?? "month";
  if (unit === "week") return t("plannedExpenseRecurrenceUnit_week");
  if (unit === "year") return t("plannedExpenseRecurrenceUnit_year");
  return t("plannedExpenseRecurrenceUnit_month");
}

function recurrenceFrequencyLabel(item: PlannedExpense, t: Translate): string {
  if (item.recurrence_type !== "recurring") {
    return t("plannedExpenseOneTime");
  }

  const interval =
    item.recurrence_interval ?? item.recurrence_interval_months ?? 1;
  const base = `${t("plannedExpenseEveryInterval")} ${interval} ${recurrenceUnitLabel(
    item,
    t,
  )}`;
  if (item.recurrence_unit !== "month") return base;

  const mode =
    item.recurrence_monthly_mode === "week_of_month"
      ? t("plannedExpenseMonthlyWeekday")
      : t("plannedExpenseMonthlyDay");
  return `${base} / ${mode}`;
}

function calendarTotalsByCurrency(entries: CalendarDayEntry[]) {
  const totals = new Map<string, number>();
  for (const entry of entries) {
    const currency = entry.item.currency;
    totals.set(
      currency,
      (totals.get(currency) ?? 0) + plannedExpenseCalendarEntryAmount(entry),
    );
  }
  return totals;
}

function calendarPrimaryTotal(
  entries: CalendarDayEntry[],
  selectedCurrency: string,
  convertCurrency: ConvertCurrency,
) {
  if (entries.length === 0) return null;
  const amount = entries.reduce((sum, entry) => {
    const entryAmount = plannedExpenseCalendarEntryAmount(entry);
    return (
      sum +
      (entry.item.currency === selectedCurrency
        ? entryAmount
        : convertCurrency(entryAmount, entry.item.currency, selectedCurrency))
    );
  }, 0);
  return { currency: selectedCurrency, amount };
}

function compareShoppingItems(a: PlannedExpense, b: PlannedExpense) {
  return (
    Number(b.keep_on_routine_clear) - Number(a.keep_on_routine_clear) ||
    a.id - b.id
  );
}

function buildUniqueRestoredShoppingPlanName(
  baseName: string,
  existingNames: Set<string>,
  restoredSuffix: string,
) {
  const normalizedBaseName = baseName.trim();
  if (!existingNames.has(normalizedBaseName)) return normalizedBaseName;

  let index = 1;
  let candidate = `${normalizedBaseName}${restoredSuffix}`;
  while (existingNames.has(candidate.trim())) {
    index += 1;
    candidate = `${normalizedBaseName}${restoredSuffix} ${index}`;
  }
  return candidate;
}

function ShoppingPlanList({
  loading,
  isEmpty,
  groups,
  t,
  locale,
  selectedCurrency,
  convertCurrency,
  accountNameById,
  inlineDraft,
  categoryEmptyLabel,
  onOpenAddItem,
  onInlineNameChange,
  onInlineKeepOnClearChange,
  onInlineSave,
  onInlineCancel,
  onCompletePlan,
  onCheckoutPlan,
  onEditPlan,
  onDeletePlan,
  onToggleItem,
  onEditItem,
  onDeleteItem,
}: {
  loading: boolean;
  isEmpty: boolean;
  groups: ShoppingPlanGroup[];
  t: Translate;
  locale: string;
  selectedCurrency: string;
  convertCurrency: ConvertCurrency;
  accountNameById: Map<number, string>;
  inlineDraft: InlineShoppingItemDraft | null;
  categoryEmptyLabel: string;
  onOpenAddItem: (categoryId: number) => void;
  onInlineNameChange: (name: string) => void;
  onInlineKeepOnClearChange: (keepOnRoutineClear: boolean) => void;
  onInlineSave: () => void;
  onInlineCancel: () => void;
  onCompletePlan: (category: PlannedExpenseCategory) => void;
  onCheckoutPlan: (
    category: PlannedExpenseCategory,
    items: PlannedExpense[],
  ) => void;
  onEditPlan: (category: PlannedExpenseCategory) => void;
  onDeletePlan: (category: PlannedExpenseCategory) => void;
  onToggleItem: (item: PlannedExpense, checked: boolean) => void;
  onEditItem: (item: PlannedExpense) => void;
  onDeleteItem: (item: PlannedExpense) => void;
}) {
  if (loading) {
    return (
      <Stack>
        <Skeleton height={112} radius="md" />
        <Skeleton height={112} radius="md" />
        <Skeleton height={112} radius="md" />
      </Stack>
    );
  }

  if (isEmpty) {
    return (
      <Paper withBorder p="xl" radius="md">
        <Center>
          <Stack gap="xs" align="center">
            <IconShoppingCart size={36} color="var(--mantine-color-dimmed)" />
            <Text size="sm" c="dimmed">
              {t("plannedExpenseEmpty")}
            </Text>
          </Stack>
        </Center>
      </Paper>
    );
  }

  return (
    <Stack gap="md">
      {groups.map((group) => (
        <ShoppingPlanSection
          key={group.id ?? "__none"}
          group={group}
          t={t}
          locale={locale}
          selectedCurrency={selectedCurrency}
          convertCurrency={convertCurrency}
          accountNameById={accountNameById}
          inlineDraft={inlineDraft}
          categoryEmptyLabel={categoryEmptyLabel}
          onOpenAddItem={onOpenAddItem}
          onInlineNameChange={onInlineNameChange}
          onInlineKeepOnClearChange={onInlineKeepOnClearChange}
          onInlineSave={onInlineSave}
          onInlineCancel={onInlineCancel}
          onCompletePlan={onCompletePlan}
          onCheckoutPlan={onCheckoutPlan}
          onEditPlan={onEditPlan}
          onDeletePlan={onDeletePlan}
          onToggleItem={onToggleItem}
          onEditItem={onEditItem}
          onDeleteItem={onDeleteItem}
        />
      ))}
    </Stack>
  );
}

function ShoppingPlanSection({
  group,
  t,
  locale,
  selectedCurrency,
  convertCurrency,
  accountNameById,
  inlineDraft,
  categoryEmptyLabel,
  onOpenAddItem,
  onInlineNameChange,
  onInlineKeepOnClearChange,
  onInlineSave,
  onInlineCancel,
  onCompletePlan,
  onCheckoutPlan,
  onEditPlan,
  onDeletePlan,
  onToggleItem,
  onEditItem,
  onDeleteItem,
}: {
  group: ShoppingPlanGroup;
  t: Translate;
  locale: string;
  selectedCurrency: string;
  convertCurrency: ConvertCurrency;
  accountNameById: Map<number, string>;
  inlineDraft: InlineShoppingItemDraft | null;
  categoryEmptyLabel: string;
  onOpenAddItem: (categoryId: number) => void;
  onInlineNameChange: (name: string) => void;
  onInlineKeepOnClearChange: (keepOnRoutineClear: boolean) => void;
  onInlineSave: () => void;
  onInlineCancel: () => void;
  onCompletePlan: (category: PlannedExpenseCategory) => void;
  onCheckoutPlan: (
    category: PlannedExpenseCategory,
    items: PlannedExpense[],
  ) => void;
  onEditPlan: (category: PlannedExpenseCategory) => void;
  onDeletePlan: (category: PlannedExpenseCategory) => void;
  onToggleItem: (item: PlannedExpense, checked: boolean) => void;
  onEditItem: (item: PlannedExpense) => void;
  onDeleteItem: (item: PlannedExpense) => void;
}) {
  const category = group.category;
  const isAddingInline =
    category != null && inlineDraft?.categoryId === category.id;
  const shoppingPlanDate = category?.target_date
    ? dayjs(category.target_date).format("YYYY/MM/DD")
    : null;
  const defaultExpenseAccountName =
    category?.default_expense_account_id == null
      ? null
      : accountNameById.get(category.default_expense_account_id) ?? null;
  const lastCheckedOutLabel =
    category?.shopping_plan_type === "routine" && category.last_checked_out_date
      ? `${t("shoppingPlanLastCheckoutDate")} ${dayjs(category.last_checked_out_date).format("YYYY/MM/DD")}`
      : null;
  const detailParts = [
    category
      ? formatCurrency(category.estimated_amount, locale, category.currency)
      : null,
    defaultExpenseAccountName,
    lastCheckedOutLabel,
  ].filter((part): part is string => Boolean(part));

  return (
    <Paper withBorder radius="md" style={{ overflow: "hidden" }}>
      <Box px="md" py="sm" bg="var(--mantine-color-default-hover)">
        <Group justify="space-between" align="flex-start" gap="xs">
          <Box style={{ minWidth: 0, flex: 1 }}>
            <Group gap={6} wrap="nowrap" align="center">
              {category?.shopping_plan_type === "routine" && (
                <IconRefresh
                  size={15}
                  color="var(--mantine-color-dimmed)"
                  style={{ flex: "0 0 auto" }}
                />
              )}
              <Text fw={800} size="md" style={{ minWidth: 0 }}>
                {shoppingPlanDate ? `${shoppingPlanDate} ` : ""}
                {group.name}
              </Text>
            </Group>
            {detailParts.length > 0 && (
              <Text size="xs" c="dimmed" mt={3} lineClamp={1}>
                {detailParts.join(" / ")}
              </Text>
            )}
            {category && (
              <ReferenceAmount
                amount={category.estimated_amount}
                sourceCurrency={category.currency}
                selectedCurrency={selectedCurrency}
                convertCurrency={convertCurrency}
                locale={locale}
                t={t}
              />
            )}
          </Box>
          {category && (
            <Menu withinPortal position="bottom-end" shadow="md">
              <Menu.Target>
                <ActionIcon
                  variant="subtle"
                  aria-label={t("shoppingPlanActions")}
                  style={{ flex: "0 0 auto" }}
                >
                  <IconDotsVertical size={17} />
                </ActionIcon>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Item
                  leftSection={<IconEdit size={14} />}
                  onClick={() => onEditPlan(category)}
                >
                  {t("editLabel")}
                </Menu.Item>
                <Menu.Item
                  color="red"
                  leftSection={<IconTrash size={14} />}
                  onClick={() => onDeletePlan(category)}
                >
                  {t("shoppingPlanDelete")}
                </Menu.Item>
                {group.items.length > 0 &&
                  category.shopping_plan_type === "routine" && (
                    <Menu.Item
                      color="red"
                      leftSection={<IconX size={14} />}
                      onClick={() => onCompletePlan(category)}
                    >
                      {t("shoppingPlanClearItems")}
                    </Menu.Item>
                  )}
              </Menu.Dropdown>
            </Menu>
          )}
        </Group>
        {category && group.items.length > 0 && (
          <Group justify="flex-end" mt="xs">
            <Button
              size="xs"
              variant="light"
              leftSection={<IconReceipt size={14} />}
              onClick={() => onCheckoutPlan(category, group.items)}
            >
              {t("shoppingPlanCheckout")}
            </Button>
          </Group>
        )}
      </Box>

      <Stack gap={0}>
        {group.items.length === 0 && !isAddingInline ? (
          <Text size="sm" c="dimmed" px="md" py="sm">
            {categoryEmptyLabel}
          </Text>
        ) : (
          group.items.map((item) => (
            <ShoppingItemRow
              key={item.id}
              item={item}
              t={t}
              selectedCurrency={selectedCurrency}
              onToggleItem={onToggleItem}
              onEditItem={onEditItem}
              onDeleteItem={onDeleteItem}
            />
          ))
        )}
      </Stack>

      {category && (
        <Box
          px="md"
          py="xs"
          style={{ borderTop: "1px solid var(--mantine-color-default-border)" }}
        >
          {isAddingInline && inlineDraft ? (
            <Stack gap={6}>
              <Group gap="xs" align="flex-start" wrap="nowrap">
                <TextInput
                  autoFocus
                  size="sm"
                  placeholder={t("plannedExpenseName")}
                  value={inlineDraft.name}
                  error={inlineDraft.error}
                  onChange={(event) =>
                    onInlineNameChange(event.currentTarget.value)
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      onInlineSave();
                    }
                    if (event.key === "Escape") {
                      onInlineCancel();
                    }
                  }}
                  style={{ flex: 1 }}
                />
                <Button
                  size="sm"
                  leftSection={<IconCheck size={14} />}
                  loading={inlineDraft.saving}
                  disabled={!inlineDraft.name.trim()}
                  onClick={onInlineSave}
                >
                  {t("save")}
                </Button>
                <ActionIcon
                  size="lg"
                  variant="subtle"
                  aria-label={t("cancel")}
                  onClick={onInlineCancel}
                >
                  <IconX size={16} />
                </ActionIcon>
              </Group>
              {category.shopping_plan_type === "routine" && (
                <Checkbox
                  label={t("shoppingPlanKeepItemOnClear")}
                  checked={inlineDraft.keepOnRoutineClear}
                  onChange={(event) =>
                    onInlineKeepOnClearChange(event.currentTarget.checked)
                  }
                />
              )}
            </Stack>
          ) : (
            <Button
              fullWidth
              justify="flex-start"
              variant="subtle"
              size="sm"
              leftSection={<IconPlus size={15} />}
              onClick={() => onOpenAddItem(category.id)}
            >
              {t("shoppingPlanAddItem")}
            </Button>
          )}
        </Box>
      )}
    </Paper>
  );
}

function ShoppingItemRow({
  item,
  t,
  selectedCurrency,
  onToggleItem,
  onEditItem,
  onDeleteItem,
}: {
  item: PlannedExpense;
  t: Translate;
  selectedCurrency: string;
  onToggleItem: (item: PlannedExpense, checked: boolean) => void;
  onEditItem: (item: PlannedExpense) => void;
  onDeleteItem: (item: PlannedExpense) => void;
}) {
  const isReferenceCurrency = item.currency !== selectedCurrency;
  const isCompleted = item.status === "completed";

  return (
    <Box
      px="md"
      py="xs"
      style={{
        borderTop: "1px solid var(--mantine-color-default-border)",
        opacity: isCompleted ? 0.62 : 1,
      }}
    >
      <Group gap="sm" align="center" wrap="nowrap">
        <Checkbox
          checked={isCompleted}
          onChange={(event) => onToggleItem(item, event.currentTarget.checked)}
          aria-label={t("plannedExpenseComplete")}
        />
        <Box style={{ minWidth: 0, flex: 1 }}>
          <Group gap="xs" wrap="nowrap">
            {item.keep_on_routine_clear && (
              <Tooltip label={t("shoppingPlanKeepItemOnClear")}>
                <ThemeIcon
                  size={18}
                  radius="xl"
                  color="yellow"
                  variant="light"
                  style={{ flex: "0 0 auto" }}
                >
                  <IconStarFilled size={12} />
                </ThemeIcon>
              </Tooltip>
            )}
            <Text fw={650} size="sm" lineClamp={1}>
              {item.name}
            </Text>
            {isReferenceCurrency && (
              <Badge size="xs" color="gray" variant="outline">
                {t("plannedExpenseReferenceCurrency")}
              </Badge>
            )}
          </Group>
          {item.note && (
            <Text size="xs" c="dimmed" lineClamp={1} mt={2}>
              {item.note}
            </Text>
          )}
        </Box>
        <Group gap={2} wrap="nowrap">
          <Menu withinPortal position="bottom-end" shadow="md">
            <Menu.Target>
              <ActionIcon variant="subtle" aria-label={t("shoppingPlanActions")}>
                <IconDotsVertical size={16} />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item
                leftSection={<IconEdit size={14} />}
                onClick={() => onEditItem(item)}
              >
                {t("editLabel")}
              </Menu.Item>
              <Menu.Item
                color="red"
                leftSection={<IconTrash size={14} />}
                onClick={() => onDeleteItem(item)}
              >
                {t("deleteBudgetCategory")}
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </Group>
      </Group>
    </Box>
  );
}

function ArchivedShoppingPlanList({
  groups,
  t,
  locale,
  selectedCurrency,
  convertCurrency,
  accountNameById,
  onRestorePlan,
  onRestoreItem,
}: {
  groups: ShoppingPlanGroup[];
  t: Translate;
  locale: string;
  selectedCurrency: string;
  convertCurrency: ConvertCurrency;
  accountNameById: Map<number, string>;
  onRestorePlan: (group: ShoppingPlanGroup) => void;
  onRestoreItem: (group: ShoppingPlanGroup, item: PlannedExpense) => void;
}) {
  if (groups.length === 0) return null;

  return (
    <Accordion variant="contained" radius="md">
      <Accordion.Item value="archived-shopping-plans">
        <Accordion.Control>
          <Group gap="xs">
            <Text fw={800} size="sm">
              {t("shoppingPlanArchivedTitle")}
            </Text>
            <Text size="sm" c="dimmed">
              {groups.length}
            </Text>
          </Group>
        </Accordion.Control>
        <Accordion.Panel>
          <Stack gap="sm">
            {groups.map((group) => {
              const category = group.category;
              const latestCompletedAt = group.items.reduce<string | null>(
                (latest, item) =>
                  !latest || item.updated_at > latest ? item.updated_at : latest,
                null,
              );
              const completedAt = category?.archived_at
                ? dayjs(category.archived_at).format("YYYY/MM/DD")
                : latestCompletedAt
                  ? dayjs(latestCompletedAt).format("YYYY/MM/DD")
                  : null;
              const planDate = category?.target_date
                ? dayjs(category.target_date).format("YYYY/MM/DD")
                : null;
              const defaultExpenseAccountName =
                category?.default_expense_account_id == null
                  ? null
                  : accountNameById.get(category.default_expense_account_id) ??
                    null;
              const lastCheckedOutLabel =
                category?.shopping_plan_type === "routine" &&
                category.last_checked_out_date
                  ? `${t("shoppingPlanLastCheckoutDate")} ${dayjs(category.last_checked_out_date).format("YYYY/MM/DD")}`
                  : null;
              const detailParts = [
                category
                  ? formatCurrency(
                      category.estimated_amount,
                      locale,
                      category.currency,
                    )
                  : null,
                defaultExpenseAccountName,
                lastCheckedOutLabel,
              ].filter((part): part is string => Boolean(part));

              return (
                <Paper key={group.id ?? "__archived_none"} withBorder radius="md">
                  <Box px="md" py="sm" bg="var(--mantine-color-default-hover)">
                    <Group justify="space-between" align="flex-start" gap="xs">
                      <Box style={{ minWidth: 0, flex: 1 }}>
                        <Group gap={6} wrap="nowrap" align="center">
                          {category?.shopping_plan_type === "routine" && (
                            <IconRefresh
                              size={15}
                              color="var(--mantine-color-dimmed)"
                              style={{ flex: "0 0 auto" }}
                            />
                          )}
                          <Text
                            fw={700}
                            size="sm"
                            c="dimmed"
                            style={{ minWidth: 0 }}
                          >
                            {planDate ? `${planDate} ` : ""}
                            {group.name}
                          </Text>
                        </Group>
                        {detailParts.length > 0 && (
                          <Text size="xs" c="dimmed" mt={3} lineClamp={1}>
                            {detailParts.join(" / ")}
                          </Text>
                        )}
                        {category && (
                          <ReferenceAmount
                            amount={category.estimated_amount}
                            sourceCurrency={category.currency}
                            selectedCurrency={selectedCurrency}
                            convertCurrency={convertCurrency}
                            locale={locale}
                            t={t}
                          />
                        )}
                      </Box>
                      {completedAt && (
                        <Text size="xs" c="dimmed" style={{ flex: "0 0 auto" }}>
                          {completedAt}
                        </Text>
                      )}
                      {category && (
                        <Button
                          size="xs"
                          variant="light"
                          leftSection={<IconRefresh size={14} />}
                          onClick={() => onRestorePlan(group)}
                          style={{ flex: "0 0 auto" }}
                        >
                          {t("shoppingPlanRestore")}
                        </Button>
                      )}
                    </Group>
                  </Box>
                  <Stack gap={0}>
                    {group.items.map((item) => (
                      <Box
                        key={item.id}
                        px="md"
                        py="xs"
                        style={{
                          borderTop:
                            "1px solid var(--mantine-color-default-border)",
                          opacity: 0.72,
                        }}
                      >
                        <Group gap="sm" wrap="nowrap">
                          <Checkbox
                            checked={item.status === "completed"}
                            disabled
                            aria-label={item.name}
                          />
                          <Box style={{ minWidth: 0, flex: 1 }}>
                            <Group gap="xs" wrap="nowrap">
                              {item.keep_on_routine_clear && (
                                <Tooltip label={t("shoppingPlanKeepItemOnClear")}>
                                  <ThemeIcon
                                    size={18}
                                    radius="xl"
                                    color="yellow"
                                    variant="light"
                                    style={{ flex: "0 0 auto" }}
                                  >
                                    <IconStarFilled size={12} />
                                  </ThemeIcon>
                                </Tooltip>
                              )}
                              <Text size="sm" lineClamp={1}>
                                {item.name}
                              </Text>
                            </Group>
                            {item.note && (
                              <Text size="xs" c="dimmed" lineClamp={1} mt={2}>
                                {item.note}
                              </Text>
                            )}
                          </Box>
                          <Tooltip label={t("shoppingPlanRestoreItem")}>
                            <ActionIcon
                              variant="subtle"
                              size="sm"
                              aria-label={t("shoppingPlanRestoreItem")}
                              onClick={() => onRestoreItem(group, item)}
                              style={{ flex: "0 0 auto" }}
                            >
                              <IconRefresh size={15} />
                            </ActionIcon>
                          </Tooltip>
                        </Group>
                      </Box>
                    ))}
                  </Stack>
                </Paper>
              );
            })}
          </Stack>
        </Accordion.Panel>
      </Accordion.Item>
    </Accordion>
  );
}

function CompletedWishlistList({
  groups,
  t,
  locale,
  selectedCurrency,
  convertCurrency,
  pageColor,
  onReopenItem,
  onEditItem,
  onDeleteItem,
}: {
  groups: ShoppingPlanGroup[];
  t: Translate;
  locale: string;
  selectedCurrency: string;
  convertCurrency: ConvertCurrency;
  pageColor: string;
  onReopenItem: (item: PlannedExpense) => void;
  onEditItem: (item: PlannedExpense) => void;
  onDeleteItem: (item: PlannedExpense) => void;
}) {
  const visibleGroups = groups.filter((group) => group.items.length > 0);
  const showAmountTotal = shouldShowCompletedWishlistAmountTotal();
  const completedCount = visibleGroups.reduce(
    (count, group) => count + group.items.length,
    0,
  );
  if (completedCount === 0) return null;

  return (
    <Accordion variant="contained" radius="md">
      <Accordion.Item value="completed-wishlist">
        <Accordion.Control>
          <Group gap="xs">
            <Text fw={800} size="sm">
              {t("plannedExpenseCompletedWishlist")}
            </Text>
            <Text size="sm" c="dimmed">
              {completedCount}
            </Text>
          </Group>
        </Accordion.Control>
        <Accordion.Panel>
          <Stack gap="sm">
            {visibleGroups.map((group) => (
                <Paper
                  key={group.id ?? "__completed_wishlist_none"}
                  withBorder
                  radius="md"
                >
                  <Box px="md" py="xs" bg="var(--mantine-color-default-hover)">
                    <Group justify="space-between" gap="xs" wrap="nowrap">
                      <Text fw={700} size="sm" style={{ minWidth: 0 }}>
                        {group.name}
                      </Text>
                      <Group gap={6} wrap="nowrap" style={{ flex: "0 0 auto" }}>
                        <Badge size="xs" variant="light" color={pageColor}>
                          {group.items.length}
                        </Badge>
                        {showAmountTotal && (
                          <Badge size="xs" variant="light" color={pageColor}>
                            {formatCurrency(
                              group.items.reduce(
                                (sum, item) =>
                                  sum +
                                  (item.currency === selectedCurrency
                                    ? item.estimated_amount
                                    : convertCurrency(
                                        item.estimated_amount,
                                        item.currency,
                                        selectedCurrency,
                                      )),
                                0,
                              ),
                              locale,
                              selectedCurrency,
                            )}
                          </Badge>
                        )}
                      </Group>
                    </Group>
                  </Box>
                  <Stack gap={0}>
                    {group.items.map((item) => (
                      <Box
                        key={item.id}
                        px="md"
                        py="sm"
                        style={{
                          borderTop:
                            "1px solid var(--mantine-color-default-border)",
                        }}
                      >
                        <Group align="flex-start" gap="sm" wrap="nowrap">
                          <Box style={{ minWidth: 0, flex: 1 }}>
                            <Text
                              fw={700}
                              size="sm"
                              lineClamp={2}
                              style={{ wordBreak: "break-word" }}
                            >
                              {item.name}
                            </Text>
                            <Group gap={4} mt={4} wrap="wrap">
                              <Text size="xs" c="dimmed">
                                {formatCurrency(
                                  item.estimated_amount,
                                  locale,
                                  item.currency,
                                )}
                              </Text>
                              <ReferenceAmount
                                amount={item.estimated_amount}
                                sourceCurrency={item.currency}
                                selectedCurrency={selectedCurrency}
                                convertCurrency={convertCurrency}
                                locale={locale}
                                t={t}
                              />
                            </Group>
                            {(item.note || item.url) && (
                              <Text size="xs" c="dimmed" lineClamp={1} mt={2}>
                                {item.note || item.url}
                              </Text>
                            )}
                          </Box>
                          <Group gap={4} wrap="nowrap" style={{ flex: "0 0 auto" }}>
                            <Tooltip label={t("plannedExpenseStatus_open")} withArrow>
                              <ActionIcon
                                variant="subtle"
                                color={pageColor}
                                aria-label={t("plannedExpenseStatus_open")}
                                onClick={() => onReopenItem(item)}
                              >
                                <IconRefresh size={16} />
                              </ActionIcon>
                            </Tooltip>
                            <ActionIcon
                              variant="subtle"
                              aria-label={t("editLabel")}
                              onClick={() => onEditItem(item)}
                            >
                              <IconEdit size={16} />
                            </ActionIcon>
                            <Tooltip label={t("deleteBudgetCategory")} withArrow>
                              <ActionIcon
                                variant="subtle"
                                color="red"
                                aria-label={t("deleteBudgetCategory")}
                                onClick={() => onDeleteItem(item)}
                              >
                                <IconTrash size={16} />
                              </ActionIcon>
                            </Tooltip>
                          </Group>
                        </Group>
                      </Box>
                    ))}
                  </Stack>
                </Paper>
              ))}
          </Stack>
        </Accordion.Panel>
      </Accordion.Item>
    </Accordion>
  );
}

function completedScheduledGroupTitle(
  reason: PlannedExpenseCompletedScheduledGroup<PlannedExpense>["reason"],
  t: Translate,
) {
  if (reason === "end_date") return t("plannedExpenseEndedByDate");
  if (reason === "final_occurrence") return t("plannedExpenseEndedByCount");
  return t("plannedExpenseRecentlyCompleted");
}

function CompletedScheduledPaymentList({
  groups,
  t,
  locale,
  selectedCurrency,
  convertCurrency,
  onReopenItem,
  onEditItem,
  onDeleteItem,
}: {
  groups: Array<PlannedExpenseCompletedScheduledGroup<PlannedExpense>>;
  t: Translate;
  locale: string;
  selectedCurrency: string;
  convertCurrency: ConvertCurrency;
  onReopenItem: (item: PlannedExpense) => void;
  onEditItem: (item: PlannedExpense) => void;
  onDeleteItem: (item: PlannedExpense) => void;
}) {
  const itemCount = groups.reduce((count, group) => count + group.items.length, 0);
  if (itemCount === 0) return null;

  return (
    <Accordion variant="contained" radius="md">
      <Accordion.Item value="completed-scheduled-payments">
        <Accordion.Control>
          <Group gap="xs">
            <Text fw={800} size="sm">
              {t("plannedExpenseCompletedScheduledPayments")}
            </Text>
            <Text size="sm" c="dimmed">
              {itemCount}
            </Text>
          </Group>
        </Accordion.Control>
        <Accordion.Panel>
          <Stack gap="sm">
            {groups.map((group) => (
              <Paper key={group.reason} withBorder radius="md">
                <Box px="md" py="xs" bg="var(--mantine-color-default-hover)">
                  <Group justify="space-between" gap="xs" wrap="nowrap">
                    <Text fw={700} size="sm">
                      {completedScheduledGroupTitle(group.reason, t)}
                    </Text>
                    <Badge size="xs" variant="light">
                      {group.items.length}
                    </Badge>
                  </Group>
                </Box>
                <Stack gap={0}>
                  {group.items.map(({ item, completedAt }) => (
                    <Box
                      key={`${group.reason}-${item.id}`}
                      px="md"
                      py="sm"
                      style={{
                        borderTop:
                          "1px solid var(--mantine-color-default-border)",
                      }}
                    >
                      <Group
                        align="flex-start"
                        justify="space-between"
                        gap="sm"
                        wrap="nowrap"
                      >
                        <Box style={{ minWidth: 0, flex: 1 }}>
                          <Text
                            fw={700}
                            size="sm"
                            lineClamp={2}
                            style={{ wordBreak: "break-word" }}
                          >
                            {item.name}
                          </Text>
                          <Group gap={6} mt={4} wrap="wrap">
                            <Text size="xs" c="dimmed">
                              {formatCurrency(
                                item.estimated_amount,
                                locale,
                                item.currency,
                              )}
                            </Text>
                            <ReferenceAmount
                              amount={item.estimated_amount}
                              sourceCurrency={item.currency}
                              selectedCurrency={selectedCurrency}
                              convertCurrency={convertCurrency}
                              locale={locale}
                              t={t}
                            />
                            <Text size="xs" c="dimmed">
                              {dayjs(completedAt).format("YYYY/MM/DD")}
                            </Text>
                            <Text size="xs" c="dimmed">
                              {item.expense_account_name ??
                                t("plannedExpenseNoExpenseAccount")}
                            </Text>
                          </Group>
                          {(item.note || item.url) && (
                            <Text size="xs" c="dimmed" lineClamp={1} mt={2}>
                              {item.note || item.url}
                            </Text>
                          )}
                        </Box>
                        <Group gap={4} wrap="nowrap" style={{ flex: "0 0 auto" }}>
                          {item.status === "completed" && (
                            <Tooltip
                              label={t("plannedExpenseStatus_open")}
                              withArrow
                            >
                              <ActionIcon
                                variant="subtle"
                                aria-label={t("plannedExpenseStatus_open")}
                                onClick={() => onReopenItem(item)}
                              >
                                <IconRefresh size={16} />
                              </ActionIcon>
                            </Tooltip>
                          )}
                          <ActionIcon
                            variant="subtle"
                            aria-label={t("editLabel")}
                            onClick={() => onEditItem(item)}
                          >
                            <IconEdit size={16} />
                          </ActionIcon>
                          <Tooltip label={t("deleteBudgetCategory")} withArrow>
                            <ActionIcon
                              variant="subtle"
                              color="red"
                              aria-label={t("deleteBudgetCategory")}
                              onClick={() => onDeleteItem(item)}
                            >
                              <IconTrash size={16} />
                            </ActionIcon>
                          </Tooltip>
                        </Group>
                      </Group>
                    </Box>
                  ))}
                </Stack>
              </Paper>
            ))}
          </Stack>
        </Accordion.Panel>
      </Accordion.Item>
    </Accordion>
  );
}

export default function PlannedExpensePage({ kind }: PlannedExpensePageProps) {
  const { t, locale } = useLang();
  const {
    accounts,
    budgetCategories,
    budgetSettings,
    displayCurrency,
    enabledCurrencies,
    convertCurrency,
  } = useAppData();
  const navigate = useNavigate();
  const [items, setItems] = useState<PlannedExpense[]>([]);
  const [categories, setCategories] = useState<PlannedExpenseCategory[]>([]);
  const [archivedItems, setArchivedItems] = useState<PlannedExpense[]>([]);
  const [archivedCategories, setArchivedCategories] = useState<
    PlannedExpenseCategory[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [categorySaving, setCategorySaving] = useState(false);
  const [metadataLoading, setMetadataLoading] = useState(false);
  const [metadataPreview, setMetadataPreview] = useState<ProductMetadata | null>(
    null,
  );
  const [modalOpen, setModalOpen] = useState(false);
  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<PlannedExpense | null>(null);
  const [editingCategory, setEditingCategory] =
    useState<PlannedExpenseCategory | null>(null);
  const [deleteCategoryTarget, setDeleteCategoryTarget] =
    useState<PlannedExpenseCategory | null>(null);
  const [deleteItemTarget, setDeleteItemTarget] =
    useState<PlannedExpense | null>(null);
  const [completeItemTarget, setCompleteItemTarget] =
    useState<PlannedExpense | null>(null);
  const [restoreShoppingPlanTarget, setRestoreShoppingPlanTarget] =
    useState<ShoppingPlanGroup | null>(null);
  const [inlineShoppingItemDraft, setInlineShoppingItemDraft] =
    useState<InlineShoppingItemDraft | null>(null);
  const [wishlistDrag, setWishlistDrag] = useState<WishlistDragState | null>(
    null,
  );
  const [
    undatedShoppingPlanPosition,
    setUndatedShoppingPlanPosition,
  ] = useState<UndatedShoppingPlanPosition>(readUndatedShoppingPlanPosition);
  const [calendarMonth, setCalendarMonth] = useState(() =>
    dayjs().startOf("month"),
  );
  const [selectedCalendarDay, setSelectedCalendarDay] =
    useState<SelectedCalendarDay | null>(null);
  const [skipPolicyTarget, setSkipPolicyTarget] =
    useState<CalendarDayEntry | null>(null);
  const [pendingExpenseInput, setPendingExpenseInput] =
    useState<PlannedExpenseEntrySource | null>(null);
  const loadRequestIdRef = useRef(0);

  const isShoppingList = kind === "shopping_list";
  const isWishlist = kind === "wishlist";
  const isScheduled = kind === "scheduled_payment";
  const selectedCurrency = displayCurrency || "JPY";
  const isCalendarCompact = useMediaQuery("(max-width: 36em)");
  const calendarLayout = calendarGridLayout(Boolean(isCalendarCompact));
  const showItemStatusField = shouldShowPlannedExpenseStatusField(editingItem);
  const itemNameLineClamp = plannedExpenseItemNameLineClamp();
  const isDuplicateItemName = ({
    categoryId,
    name,
    currency,
    excludeId,
  }: {
    categoryId: number | null;
    name: string;
    currency: string;
    excludeId?: number;
  }) => {
    return hasDuplicatePlannedExpenseItemName({
      name,
      kind,
      categoryId,
      currency,
      excludeId,
      items: [...items, ...archivedItems],
    });
  };
  const handlePlannedExpenseError = (error: unknown) => {
    if (
      error instanceof ApiError &&
      error.body.error === "duplicate_planned_expense_item"
    ) {
      return t("plannedExpenseDuplicateItem");
    }
    if (
      error instanceof ApiError &&
      error.body.error === "duplicate_planned_expense_category"
    ) {
      return t("plannedExpenseDuplicateCategory");
    }
    return error instanceof Error ? error.message : String(error);
  };
  const handleUndatedShoppingPlanPositionChange = (
    value: UndatedShoppingPlanPosition,
  ) => {
    setUndatedShoppingPlanPosition(value);
    persistUndatedShoppingPlanPosition(value);
  };
  const pageTitle = isShoppingList
    ? t("shoppingListTitle")
    : isWishlist
      ? t("wishlistTitle")
      : t("scheduledPaymentsTitle");
  const pageDescription = isShoppingList
    ? t("shoppingListPageDesc")
    : isWishlist
      ? t("wishlistPageDesc")
      : t("scheduledPaymentsPageDesc");
  const Icon = isShoppingList
    ? IconShoppingCart
    : isWishlist
      ? IconGift
      : IconCalendarDollar;
  const pageColor = isShoppingList ? "green" : isWishlist ? "pink" : "blue";
  const categoryLabel = isShoppingList
    ? t("shoppingPlanLabel")
    : t("plannedExpenseCategory");
  const categoryAddLabel = isShoppingList
    ? t("shoppingPlanAdd")
    : t("plannedExpenseCategoryAdd");
  const categoryNameLabel = isShoppingList
    ? t("shoppingPlanName")
    : t("plannedExpenseCategoryName");
  const categoryNameOrDateRequiredLabel = isShoppingList
    ? t("shoppingPlanNameOrDateRequired")
    : t("plannedExpenseCategoryNameOrDateRequired");
  const categoryRequiredLabel = isShoppingList
    ? t("shoppingPlanRequired")
    : t("plannedExpenseCategoryRequired");
  const categoryEmptyLabel = isShoppingList
    ? t("shoppingPlanEmpty")
    : t("plannedExpenseCategoryEmpty");
  const categoryEstimateLabel = isShoppingList
    ? t("shoppingPlanBudgetEstimate")
    : t("plannedExpenseShoppingCategoryEstimate");
  const noCategoryLabel = isShoppingList
    ? t("shoppingPlanNone")
    : t("plannedExpenseNoCategory");
  const shoppingPlanTypeOptions = [
    { value: "one_time", label: t("shoppingPlanTypeOneTime") },
    { value: "routine", label: t("shoppingPlanTypeRoutine") },
  ];

  const expenseAccountOptions = useMemo(
    () =>
      buildAccountOptions(
        accounts.filter((account) => account.type === "expense"),
        t,
      ),
    [accounts, t],
  );
  const accountNameById = useMemo(
    () =>
      new Map(
        accounts.map((account) => [
          account.id,
          accountDisplayName(account, t),
        ]),
      ),
    [accounts, locale, t],
  );

  const currencyOptions = enabledCurrencies.map((currency) => ({
    value: currency.code,
    label: currency.code,
  }));
  const recurrenceUnitOptions = [
    { value: "week", label: t("plannedExpenseRecurrenceUnit_week") },
    { value: "month", label: t("plannedExpenseRecurrenceUnit_month") },
    { value: "year", label: t("plannedExpenseRecurrenceUnit_year") },
  ];
  const recurrenceMonthlyModeOptions = [
    {
      value: "day_of_month",
      label: t("plannedExpenseMonthlyDay"),
    },
    {
      value: "week_of_month",
      label: t("plannedExpenseMonthlyWeekday"),
    },
  ];
  const recurrenceEndModeOptions = [
    { value: "date", label: t("plannedExpenseEndConditionDate") },
    { value: "count", label: t("plannedExpenseEndConditionCount") },
  ];
  const recurrenceWeekOfMonthOptions = [
    { value: "1", label: t("plannedExpenseWeekOfMonth_1") },
    { value: "2", label: t("plannedExpenseWeekOfMonth_2") },
    { value: "3", label: t("plannedExpenseWeekOfMonth_3") },
    { value: "4", label: t("plannedExpenseWeekOfMonth_4") },
    { value: "5", label: t("plannedExpenseWeekOfMonth_5") },
  ];
  const recurrenceWeekdayOptions = [
    { value: "0", label: t("weekday_short_0") },
    { value: "1", label: t("weekday_short_1") },
    { value: "2", label: t("weekday_short_2") },
    { value: "3", label: t("weekday_short_3") },
    { value: "4", label: t("weekday_short_4") },
    { value: "5", label: t("weekday_short_5") },
    { value: "6", label: t("weekday_short_6") },
  ];
  const recurrenceWeekFallbackOptions = [
    {
      value: "skip",
      label: t("plannedExpenseWeekFallback_skip"),
    },
    {
      value: "last_day_of_month",
      label: t("plannedExpenseWeekFallback_last_day_of_month"),
    },
    {
      value: "previous_week",
      label: t("plannedExpenseWeekFallback_previous_week"),
    },
    {
      value: "next_month_first_week",
      label: t("plannedExpenseWeekFallback_next_month_first_week"),
    },
  ];
  const recurrenceDayOfMonthOptions = plannedExpenseDayOfMonthSelectOptions(t);

  const form = useForm<PlannedExpenseFormValues>({
    initialValues: {
      category_id: null,
      name: "",
      estimated_amount: "",
      currency: selectedCurrency,
      expense_account_id: null,
      target_date: null,
      recurrence_type: "one_time",
      recurrence_interval: 1,
      recurrence_unit: "month",
      recurrence_monthly_mode: "day_of_month",
      recurrence_day: null,
      recurrence_weeks_of_month: [],
      recurrence_weekday: null,
      recurrence_week_fallback: "previous_week",
      next_due_date: null,
      recurrence_end_mode: "date",
      end_date: null,
      recurrence_count: "",
      status: "open",
      keep_on_routine_clear: false,
      note: "",
      url: "",
      product_metadata_cache_id: null,
    },
    validate: {
      category_id: (value) =>
        isShoppingList && value == null ? categoryRequiredLabel : null,
      name: (value) => (value.trim() ? null : t("nameIsRequired")),
      estimated_amount: (value) => {
        if (isShoppingList) return null;
        return typeof value === "number" && value >= 0
          ? null
          : t("amountMustBePositive");
      },
    },
  });

  const categoryOptions = categoriesForPlannedExpenseCurrency(
    categories,
    form.values.currency,
  ).map((category) => ({
    value: String(category.id),
    label: category.name,
  }));

  const recurrencePreviewItem = useMemo(() => {
    const recurrenceType = isScheduled ? form.values.recurrence_type : "one_time";
    if (!isScheduled || recurrenceType !== "recurring") return null;
    const usesMonthlyDayRule =
      form.values.recurrence_unit === "month" &&
      form.values.recurrence_monthly_mode === "day_of_month";
    const usesMonthlyWeekdayRule =
      form.values.recurrence_unit === "month" &&
      form.values.recurrence_monthly_mode === "week_of_month";
    const recurrenceDay =
      usesMonthlyDayRule && form.values.recurrence_day != null
        ? Number(form.values.recurrence_day)
        : null;
    const recurrenceWeeksOfMonth = usesMonthlyWeekdayRule
      ? serializePlannedExpenseWeeksOfMonth(form.values.recurrence_weeks_of_month)
      : null;
    const recurrenceWeekday =
      usesMonthlyWeekdayRule && form.values.recurrence_weekday != null
        ? Number(form.values.recurrence_weekday)
        : null;
    const rawNextDueDate = inputDateToString(form.values.next_due_date);
    const nextDueDate = usesMonthlyDayRule
      ? plannedExpenseMonthlyDueDateFromDay(rawNextDueDate, recurrenceDay)
      : usesMonthlyWeekdayRule
        ? resolvePlannedExpenseWeekdayRuleDate({
            date: rawNextDueDate,
            weeksOfMonth: recurrenceWeeksOfMonth,
            weekday: recurrenceWeekday,
            fallback: form.values.recurrence_week_fallback,
          })
        : rawNextDueDate;

    return {
      kind: "scheduled_payment" as const,
      recurrence_type: "recurring" as const,
      recurrence_interval: Number(form.values.recurrence_interval || 1),
      recurrence_unit: form.values.recurrence_unit,
      recurrence_monthly_mode:
        form.values.recurrence_unit === "month"
          ? form.values.recurrence_monthly_mode
          : null,
      recurrence_interval_months:
        form.values.recurrence_unit === "month"
          ? Number(form.values.recurrence_interval || 1)
          : null,
      recurrence_day: usesMonthlyDayRule ? recurrenceDay : null,
      recurrence_weeks_of_month: usesMonthlyWeekdayRule
        ? recurrenceWeeksOfMonth
        : null,
      recurrence_weekday: usesMonthlyWeekdayRule ? recurrenceWeekday : null,
      recurrence_week_fallback: usesMonthlyWeekdayRule
        ? form.values.recurrence_week_fallback
        : null,
      target_date: null,
      next_due_date: nextDueDate,
      end_date: inputDateToString(form.values.end_date),
      recurrence_count:
        form.values.recurrence_count === ""
          ? null
          : Number(form.values.recurrence_count),
    };
  }, [form.values, isScheduled]);

  const recurrencePlannedCountPreview =
    form.values.recurrence_end_mode === "date" && recurrencePreviewItem
      ? plannedExpenseRecurrencePlannedCount(recurrencePreviewItem)
      : null;
  const recurrenceFinalDatePreview =
    form.values.recurrence_end_mode === "count" && recurrencePreviewItem
      ? plannedExpenseRecurrenceFinalOccurrenceDate(recurrencePreviewItem)
      : null;
  const originalRecurrencePlannedCount = useMemo(() => {
    if (!editingItem || editingItem.recurrence_type !== "recurring") {
      return null;
    }
    if (editingItem.recurrence_count != null) return editingItem.recurrence_count;
    if (editingItem.end_date) {
      return plannedExpenseRecurrencePlannedCount(editingItem);
    }
    return null;
  }, [editingItem]);
  const currentRecurrencePlannedCount =
    form.values.recurrence_end_mode === "count"
      ? form.values.recurrence_count === ""
        ? null
        : Number(form.values.recurrence_count)
      : recurrencePlannedCountPreview;
  const recurrencePlannedCountDiffHint =
    originalRecurrencePlannedCount != null &&
    currentRecurrencePlannedCount != null &&
    Number.isFinite(currentRecurrencePlannedCount) &&
    originalRecurrencePlannedCount !== currentRecurrencePlannedCount
      ? t("plannedExpensePlannedCountChangeHint")
          .replace("{from}", String(originalRecurrencePlannedCount))
          .replace("{to}", String(currentRecurrencePlannedCount))
      : null;

  const categoryForm = useForm<CategoryFormValues>({
    initialValues: {
      name: "",
      estimated_amount: "",
      currency: selectedCurrency,
      default_expense_account_id: null,
      target_date: null,
      shopping_plan_type: "one_time",
    },
    validate: {
      name: (value, values) => {
        const categoryName =
          value.trim() ||
          (isShoppingList ? inputDateToString(values.target_date) : "");
        if (!categoryName) return categoryNameOrDateRequiredLabel;
        return hasDuplicatePlannedExpenseCategoryName({
          name: categoryName,
          kind,
          currency: values.currency,
          excludeId: editingCategory?.id,
          categories,
        })
          ? t("plannedExpenseDuplicateCategory")
          : null;
      },
      estimated_amount: (value) => {
        if (!isShoppingList || value === "") return null;
        return typeof value === "number" && value >= 0
          ? null
          : t("amountMustBePositive");
      },
    },
  });

  const isUrlSupported = isWishlist && isSupportedProductUrl(form.values.url);
  const decimalPlacesForCurrency = (currencyCode: string) => {
    const configured = enabledCurrencies.find(
      (currency) => currency.code === currencyCode,
    )?.decimal_places;
    if (configured != null) return configured;
    return currencyCode === "JPY" || currencyCode === "KRW" ? 0 : 2;
  };
  const currencyDecimalPlaces = decimalPlacesForCurrency(form.values.currency);
  const categoryCurrencyDecimalPlaces = decimalPlacesForCurrency(
    categoryForm.values.currency,
  );
  const editingCategoryHasItems =
    editingCategory != null &&
    [...items, ...archivedItems].some(
      (item) => item.category_id === editingCategory.id,
    );

  const selectedExpenseAccount = useMemo(
    () =>
      form.values.expense_account_id
        ? accounts.find(
            (account) => account.id === Number(form.values.expense_account_id),
          )
        : undefined,
    [accounts, form.values.expense_account_id],
  );
  const budgetDistributionPreview = useMemo(() => {
    const amount =
      typeof form.values.estimated_amount === "number"
        ? form.values.estimated_amount
        : 0;
    if (!selectedExpenseAccount || amount <= 0) return [];
    const ratios = (selectedExpenseAccount.budget_ratios ?? []).filter(
      (ratio) => ratio.ratio > 0,
    );
    const ratioTotal = ratios.reduce((sum, ratio) => sum + ratio.ratio, 0);
    const previewInputs = ratios.map((ratio) => ({
      key: String(ratio.budget_category_id),
      name:
        ratio.budget_category_name ??
        budgetCategories.find(
          (category) => category.id === ratio.budget_category_id,
        )?.name ??
        `${t("unknownCategoryPrefix")}${ratio.budget_category_id}`,
      ratio: ratio.ratio,
    }));
    if (ratioTotal < 100) {
      previewInputs.push({
        key: "__unallocated",
        name: t("budgetDistributionPreviewUnallocated"),
        ratio: 100 - ratioTotal,
      });
    }
    const totalWeight =
      ratioTotal > 100
        ? ratioTotal
        : previewInputs.reduce((sum, row) => sum + row.ratio, 0);
    if (totalWeight <= 0 || previewInputs.length === 0) return [];

    const scale = 10 ** currencyDecimalPlaces;
    const totalUnits = Math.round(amount * scale);
    const rawRows = previewInputs.map((row) => {
      const rawUnits = (totalUnits * row.ratio) / totalWeight;
      const floorUnits = Math.floor(rawUnits);
      return {
        ...row,
        floorUnits,
        remainder: rawUnits - floorUnits,
      };
    });
    let remainingUnits =
      totalUnits - rawRows.reduce((sum, row) => sum + row.floorUnits, 0);
    const orderedIndexes = rawRows
      .map((row, index) => ({ index, remainder: row.remainder }))
      .sort((a, b) => b.remainder - a.remainder);
    const units = rawRows.map((row) => row.floorUnits);
    for (const { index } of orderedIndexes) {
      if (remainingUnits <= 0) break;
      units[index] += 1;
      remainingUnits -= 1;
    }

    return rawRows
      .map(
        (row, index): BudgetDistributionPreviewRow => ({
          key: row.key,
          name: row.name,
          ratio: row.ratio,
          amount: units[index] / scale,
          isUnallocated: row.key === "__unallocated",
        }),
      )
      .filter((row) => row.amount > 0);
  }, [
    budgetCategories,
    currencyDecimalPlaces,
    form.values.estimated_amount,
    selectedExpenseAccount,
    t,
  ]);

  const loadData = async (options: { showLoading?: boolean } = {}) => {
    const requestId = ++loadRequestIdRef.current;
    const showLoading = options.showLoading ?? false;
    if (showLoading) setLoading(true);
    try {
      const [
        nextItems,
        nextCancelledItems,
        nextCompletedItems,
        nextCategories,
        nextAllItems,
        nextAllCategories,
      ] = await Promise.all([
        isScheduled
          ? api.plannedExpenses.list({ kind, status: "open" })
          : api.plannedExpenses.list({ kind }),
        isScheduled
          ? api.plannedExpenses.list({ kind, status: "cancelled" })
          : Promise.resolve([] as PlannedExpense[]),
        isScheduled
          ? api.plannedExpenses.list({ kind, status: "completed" })
          : Promise.resolve([] as PlannedExpense[]),
        api.plannedExpenses.listCategories({ kind }),
        isShoppingList
          ? api.plannedExpenses.list({ kind, includeArchived: true })
          : Promise.resolve([] as PlannedExpense[]),
        isShoppingList
          ? api.plannedExpenses.listCategories({
              kind,
              includeArchived: true,
            })
          : Promise.resolve([] as PlannedExpenseCategory[]),
      ]);
      if (requestId !== loadRequestIdRef.current) return;
      setItems(
        preservePlannedExpensesAcrossCurrencies(
          mergePlannedExpenseListsById(
            nextItems,
            nextCancelledItems,
            nextCompletedItems,
          ),
        ),
      );
      setCategories(preservePlannedExpensesAcrossCurrencies(nextCategories));
      if (isShoppingList) {
        const archived = preservePlannedExpensesAcrossCurrencies(nextAllCategories)
          .filter((category) => category.archived_at)
          .sort((a, b) =>
            (b.archived_at ?? "").localeCompare(a.archived_at ?? ""),
          );
        const archivedIds = new Set(archived.map((category) => category.id));
        setArchivedCategories(archived);
        setArchivedItems(
          preservePlannedExpensesAcrossCurrencies(nextAllItems).filter((item) =>
            item.category_id == null
              ? false
              : archivedIds.has(item.category_id),
          ),
        );
      } else {
        setArchivedCategories([]);
        setArchivedItems([]);
      }
    } finally {
      if (showLoading && requestId === loadRequestIdRef.current) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    setItems([]);
    setCategories([]);
    setArchivedItems([]);
    setArchivedCategories([]);
    setEditingItem(null);
    setEditingCategory(null);
    setModalOpen(false);
    setCategoryModalOpen(false);
    setSelectedCalendarDay(null);
    setInlineShoppingItemDraft(null);
    void loadData({ showLoading: true });
  }, [kind]);

  const resetItemForm = () => {
    form.setValues({
      category_id: null,
      name: "",
      estimated_amount: isShoppingList ? 0 : "",
      currency: selectedCurrency,
      expense_account_id: null,
      target_date: null,
      recurrence_type: "one_time",
      recurrence_interval: 1,
      recurrence_unit: "month",
      recurrence_monthly_mode: "day_of_month",
      recurrence_day: null,
      recurrence_weeks_of_month: [],
      recurrence_weekday: null,
      recurrence_week_fallback: "previous_week",
      next_due_date: null,
      recurrence_end_mode: "date",
      end_date: null,
      recurrence_count: "",
      status: "open",
      keep_on_routine_clear: false,
      note: "",
      url: "",
      product_metadata_cache_id: null,
    });
    setMetadataPreview(null);
  };

  const openCreateModal = (categoryId?: number | null) => {
    setEditingItem(null);
    resetItemForm();
    if (categoryId !== undefined) {
      const category = categories.find((entry) => entry.id === categoryId);
      form.setFieldValue(
        "category_id",
        plannedExpenseCategorySelectValue(categoryId),
      );
      if (category) form.setFieldValue("currency", category.currency);
    }
    setModalOpen(true);
  };

  const openEditModal = (item: PlannedExpense) => {
    setEditingItem(item);
    form.setValues({
      category_id: item.category_id == null ? null : String(item.category_id),
      name: item.name,
      estimated_amount: isShoppingList ? 0 : item.estimated_amount,
      currency: item.currency,
      expense_account_id:
        item.expense_account_id == null ? null : String(item.expense_account_id),
      target_date: dateToInputDate(item.target_date),
      recurrence_type: item.recurrence_type,
      recurrence_interval:
        item.recurrence_interval ?? item.recurrence_interval_months ?? 1,
      recurrence_unit: item.recurrence_unit ?? "month",
      recurrence_monthly_mode:
        item.recurrence_monthly_mode ??
        (item.recurrence_weeks_of_month == null
          ? "day_of_month"
          : "week_of_month"),
      recurrence_day:
        item.recurrence_day == null ? null : String(item.recurrence_day),
      recurrence_weeks_of_month: parsePlannedExpenseWeeksOfMonth(
        item.recurrence_weeks_of_month,
      ),
      recurrence_weekday:
        item.recurrence_weekday == null ? null : String(item.recurrence_weekday),
      recurrence_week_fallback: item.recurrence_week_fallback ?? "previous_week",
      next_due_date: dateToInputDate(item.next_due_date),
      recurrence_end_mode: item.recurrence_count == null ? "date" : "count",
      end_date: dateToInputDate(item.end_date),
      recurrence_count: item.recurrence_count ?? "",
      status: item.status,
      keep_on_routine_clear: item.keep_on_routine_clear,
      note: item.note ?? "",
      url: item.url ?? "",
      product_metadata_cache_id: item.product_metadata_cache_id ?? null,
    });
    setMetadataPreview(item.product_metadata ?? null);
    setModalOpen(true);
  };

  const openInlineShoppingItem = (categoryId: number) => {
    setInlineShoppingItemDraft({
      categoryId,
      name: "",
      keepOnRoutineClear: false,
      saving: false,
      error: null,
    });
  };

  const updateInlineShoppingItemName = (name: string) => {
    setInlineShoppingItemDraft((draft) =>
      draft ? { ...draft, name, error: null } : draft,
    );
  };

  const updateInlineShoppingItemKeepOnClear = (
    keepOnRoutineClear: boolean,
  ) => {
    setInlineShoppingItemDraft((draft) =>
      draft ? { ...draft, keepOnRoutineClear } : draft,
    );
  };

  const saveInlineShoppingItem = async () => {
    const draft = inlineShoppingItemDraft;
    if (!draft) return;
    const category = categories.find((entry) => entry.id === draft.categoryId);
    if (!category) return;
    const name = draft.name.trim();
    if (!name) {
      setInlineShoppingItemDraft({ ...draft, error: t("nameIsRequired") });
      return;
    }
    if (
      isDuplicateItemName({
        categoryId: draft.categoryId,
        name,
        currency: category.currency,
      })
    ) {
      setInlineShoppingItemDraft({
        ...draft,
        error: t("plannedExpenseDuplicateItem"),
      });
      return;
    }
    setInlineShoppingItemDraft({ ...draft, saving: true, error: null });
    try {
      await api.plannedExpenses.create({
        kind,
        category_id: draft.categoryId,
        name,
        estimated_amount: 0,
        currency: category.currency,
        budget_category_id: null,
        expense_account_id: null,
        target_date: null,
        recurrence_type: "one_time",
        recurrence_interval: null,
        recurrence_unit: null,
        recurrence_monthly_mode: null,
        recurrence_interval_months: null,
        recurrence_day: null,
        recurrence_weeks_of_month: null,
        recurrence_weekday: null,
        recurrence_week_fallback: null,
        next_due_date: null,
        end_date: null,
        status: "open",
        keep_on_routine_clear: draft.keepOnRoutineClear,
        note: null,
        url: null,
        product_metadata_cache_id: null,
      });
      setInlineShoppingItemDraft(null);
      await loadData();
    } catch (error) {
      setInlineShoppingItemDraft((current) =>
        current?.categoryId === draft.categoryId
          ? {
              ...current,
              saving: false,
              error: handlePlannedExpenseError(error),
            }
          : current,
      );
    }
  };

  const openCreateCategoryModal = () => {
    setEditingCategory(null);
    categoryForm.setValues({
      name: "",
      estimated_amount: "",
      currency: selectedCurrency,
      default_expense_account_id: null,
      target_date: null,
      shopping_plan_type: "one_time",
    });
    setCategoryModalOpen(true);
  };

  const openEditCategoryModal = (category: PlannedExpenseCategory) => {
    setEditingCategory(category);
    categoryForm.setValues({
      name: category.name,
      estimated_amount: isShoppingList ? category.estimated_amount : "",
      currency: category.currency,
      default_expense_account_id:
        isShoppingList && category.default_expense_account_id != null
          ? String(category.default_expense_account_id)
          : null,
      target_date: isShoppingList
        ? dateToInputDate(category.target_date)
        : null,
      shopping_plan_type: category.shopping_plan_type,
    });
    setCategoryModalOpen(true);
  };

  const applyMetadataToForm = (metadata: ProductMetadata) => {
    setMetadataPreview(metadata);
    form.setFieldValue("product_metadata_cache_id", metadata.id);
    if (metadata.name) form.setFieldValue("name", metadata.name);
    if (
      metadata.price_amount != null &&
      metadata.currency === form.values.currency
    ) {
      form.setFieldValue("estimated_amount", metadata.price_amount);
    }
  };

  const lookupMetadata = async () => {
    const url = form.values.url.trim();
    if (!url || !isSupportedProductUrl(url)) return;
    setMetadataLoading(true);
    try {
      const metadata = await api.plannedExpenses.lookupMetadata({ url });
      applyMetadataToForm(metadata);
    } finally {
      setMetadataLoading(false);
    }
  };

  const handleUrlChange = (event: ChangeEvent<HTMLInputElement>) => {
    form.setFieldValue("url", event.currentTarget.value);
    form.setFieldValue("product_metadata_cache_id", null);
    setMetadataPreview(null);
  };

  const submitCategoryForm = categoryForm.onSubmit(async (values) => {
    setCategorySaving(true);
    try {
      const targetDate = isShoppingList
        ? inputDateToString(values.target_date)
        : null;
      const payload = {
        name: values.name.trim() || targetDate || "",
        estimated_amount:
          isShoppingList && typeof values.estimated_amount === "number"
            ? values.estimated_amount
            : 0,
        currency: values.currency,
        default_expense_account_id:
          isShoppingList && values.default_expense_account_id != null
            ? Number(values.default_expense_account_id)
            : null,
        target_date: targetDate,
        shopping_plan_type: isShoppingList
          ? values.shopping_plan_type
          : "one_time",
        sort_order:
          editingCategory?.sort_order ??
          categories.filter((category) => category.currency === values.currency)
            .length,
      };
      if (editingCategory) {
        await api.plannedExpenses.updateCategory(editingCategory.id, payload);
      } else {
        await api.plannedExpenses.createCategory({ ...payload, kind });
      }
      setCategoryModalOpen(false);
      await loadData();
    } catch (error) {
      categoryForm.setFieldError("name", handlePlannedExpenseError(error));
    } finally {
      setCategorySaving(false);
    }
  });

  const submitForm = form.onSubmit(async (values) => {
    setSaving(true);
    try {
      const recurrenceType = isScheduled ? values.recurrence_type : "one_time";
      const amount =
        isShoppingList || values.estimated_amount === ""
          ? 0
          : values.estimated_amount;
      const selectedFormCategory = categories.find(
        (category) => String(category.id) === values.category_id,
      );
      const keepOnRoutineClear =
        isShoppingList &&
        selectedFormCategory?.shopping_plan_type === "routine" &&
        values.keep_on_routine_clear;
      const usesMonthlyDayRule =
        isScheduled &&
        recurrenceType === "recurring" &&
        values.recurrence_unit === "month" &&
        values.recurrence_monthly_mode === "day_of_month";
      const usesMonthlyWeekdayRule =
        isScheduled &&
        recurrenceType === "recurring" &&
        values.recurrence_unit === "month" &&
        values.recurrence_monthly_mode === "week_of_month";
      const recurrenceDay =
        usesMonthlyDayRule && values.recurrence_day != null
          ? Number(values.recurrence_day)
          : null;
      const recurrenceWeeksOfMonth =
        usesMonthlyWeekdayRule
          ? serializePlannedExpenseWeeksOfMonth(
              values.recurrence_weeks_of_month,
            )
          : null;
      const recurrenceWeekday =
        usesMonthlyWeekdayRule && values.recurrence_weekday != null
          ? Number(values.recurrence_weekday)
          : null;
      const nextDueDate = inputDateToString(values.next_due_date);
      const usesEndDate =
        isScheduled &&
        recurrenceType === "recurring" &&
        values.recurrence_end_mode === "date";
      const usesRecurrenceCount =
        isScheduled &&
        recurrenceType === "recurring" &&
        values.recurrence_end_mode === "count";
      const payload = {
        category_id:
          values.category_id == null ? null : Number(values.category_id),
        name: values.name.trim(),
        estimated_amount: amount,
        currency: values.currency,
        budget_category_id: null,
        expense_account_id:
          isShoppingList || values.expense_account_id == null
            ? null
            : Number(values.expense_account_id),
        target_date:
          isShoppingList || (isScheduled && recurrenceType === "recurring")
            ? null
            : inputDateToString(values.target_date),
        recurrence_type: recurrenceType,
        recurrence_interval:
          isScheduled && recurrenceType === "recurring"
            ? Number(values.recurrence_interval || 1)
            : null,
        recurrence_unit:
          isScheduled && recurrenceType === "recurring"
            ? values.recurrence_unit
            : null,
        recurrence_monthly_mode:
          isScheduled &&
          recurrenceType === "recurring" &&
          values.recurrence_unit === "month"
            ? values.recurrence_monthly_mode
            : null,
        recurrence_interval_months:
          isScheduled &&
          recurrenceType === "recurring" &&
          values.recurrence_unit === "month"
            ? Number(values.recurrence_interval || 1)
            : null,
        recurrence_day:
          usesMonthlyDayRule ? recurrenceDay : null,
        recurrence_weeks_of_month:
          usesMonthlyWeekdayRule ? recurrenceWeeksOfMonth : null,
        recurrence_weekday:
          usesMonthlyWeekdayRule ? recurrenceWeekday : null,
        recurrence_week_fallback: usesMonthlyWeekdayRule
          ? values.recurrence_week_fallback
          : null,
        next_due_date:
          isScheduled && recurrenceType === "recurring"
            ? usesMonthlyDayRule
              ? plannedExpenseMonthlyDueDateFromDay(nextDueDate, recurrenceDay)
              : usesMonthlyWeekdayRule
                ? resolvePlannedExpenseWeekdayRuleDate({
                    date: nextDueDate,
                    weeksOfMonth: recurrenceWeeksOfMonth,
                    weekday: recurrenceWeekday,
                    fallback: values.recurrence_week_fallback,
                  })
              : nextDueDate
            : null,
        end_date:
          usesEndDate
            ? inputDateToString(values.end_date)
            : null,
        recurrence_count:
          usesRecurrenceCount && values.recurrence_count !== ""
            ? Number(values.recurrence_count)
            : null,
        sort_order:
          editingItem?.sort_order ??
          items.filter(
            (item) =>
              item.currency === values.currency &&
              (item.category_id ?? null) ===
              (values.category_id == null ? null : Number(values.category_id)),
          ).length,
        status: values.status,
        keep_on_routine_clear: keepOnRoutineClear,
        note: values.note.trim() || null,
        url: isWishlist ? values.url.trim() || null : null,
        product_metadata_cache_id: isWishlist
          ? values.product_metadata_cache_id
          : null,
      };
      if (
        isDuplicateItemName({
          categoryId: payload.category_id,
          name: payload.name,
          currency: payload.currency,
          excludeId: editingItem?.id,
        })
      ) {
        form.setFieldError("name", t("plannedExpenseDuplicateItem"));
        return;
      }
      if (editingItem) {
        await api.plannedExpenses.update(editingItem.id, payload);
      } else {
        await api.plannedExpenses.create({ ...payload, kind });
      }
      setModalOpen(false);
      await loadData();
    } catch (error) {
      const message = handlePlannedExpenseError(error);
      form.setFieldError("name", message);
    } finally {
      setSaving(false);
    }
  });

  const updateStatus = async (
    item: PlannedExpense,
    status: PlannedExpenseStatus,
  ) => {
    const previousItems = items;
    if (isShoppingList) {
      setItems((currentItems) =>
        currentItems.map((currentItem) =>
          currentItem.id === item.id
            ? { ...currentItem, status }
            : currentItem,
        ),
      );
    }
    const category = categories.find((entry) => entry.id === item.category_id);
    try {
      await api.plannedExpenses.update(item.id, { status });
      if (
        isShoppingList &&
        status === "completed" &&
        category?.shopping_plan_type === "one_time" &&
        !previousItems.some(
          (entry) =>
            entry.id !== item.id &&
            entry.category_id === item.category_id &&
            entry.status === "open",
        )
      ) {
        await api.plannedExpenses.updateCategory(category.id, {
          archived_at: new Date().toISOString(),
        });
      }
      await loadData();
    } catch (error) {
      if (isShoppingList) setItems(previousItems);
      throw error;
    }
  };

  const completeCategory = async (category: PlannedExpenseCategory | null) => {
    const categoryId = category?.id ?? null;
    const categoryItems = items.filter((item) => item.category_id === categoryId);
    if (isShoppingList && category?.shopping_plan_type === "routine") {
      const itemsToKeep = categoryItems.filter(
        (item) => item.keep_on_routine_clear,
      );
      const itemsToComplete = categoryItems.filter(
        (item) => !item.keep_on_routine_clear,
      );
      await Promise.all(
        [
          ...itemsToComplete.map((item) => api.plannedExpenses.delete(item.id)),
          ...itemsToKeep.map((item) =>
            api.plannedExpenses.update(item.id, { status: "open" }),
          ),
        ],
      );
      await loadData();
      return;
    }

    if (isShoppingList && category?.shopping_plan_type === "one_time") {
      await api.plannedExpenses.updateCategory(category.id, {
        archived_at: new Date().toISOString(),
      });
      await loadData();
      return;
    }

    const targets = categoryItems.filter((item) => item.status === "open");
    await Promise.all(
      targets.map((item) =>
        api.plannedExpenses.update(item.id, { status: "completed" }),
      ),
    );
    await loadData();
  };

  const restoreArchivedShoppingPlan = async (group: ShoppingPlanGroup) => {
    if (!group.category) return;
    const existingActiveNames = new Set(
      categories
        .filter(
          (category) =>
            category.id !== group.category?.id &&
            category.currency === group.category?.currency,
        )
        .map((category) => category.name.trim()),
    );
    const restoredName = buildUniqueRestoredShoppingPlanName(
      group.category.name,
      existingActiveNames,
      t("shoppingPlanRestoredNameSuffix"),
    );
    await api.plannedExpenses.updateCategory(group.category.id, {
      archived_at: null,
      name: restoredName,
      shopping_plan_type: "one_time",
    });
    await loadData();
  };

  const restoreArchivedShoppingItem = async (
    group: ShoppingPlanGroup,
    item: PlannedExpense,
  ) => {
    if (!group.category) return;
    await Promise.all([
      group.category.archived_at
        ? api.plannedExpenses.updateCategory(group.category.id, {
            archived_at: null,
          })
        : Promise.resolve(null),
      api.plannedExpenses.update(item.id, { status: "open" }),
    ]);
    await loadData();
  };

  const deleteItem = async (item: PlannedExpense) => {
    await api.plannedExpenses.delete(item.id);
    await loadData();
  };

  const deleteCategory = async (category: PlannedExpenseCategory) => {
    await api.plannedExpenses.deleteCategory(category.id);
    await loadData();
  };

  const requestDeleteCategory = (category: PlannedExpenseCategory) => {
    if (plannedExpenseActionRequiresConfirmation("delete_category")) {
      setDeleteCategoryTarget(category);
      return;
    }
    void deleteCategory(category);
  };

  const requestDeleteItem = (item: PlannedExpense) => {
    if (plannedExpenseActionRequiresConfirmation("delete_item")) {
      setDeleteItemTarget(item);
      return;
    }
    void deleteItem(item);
  };

  const requestCompleteItem = (item: PlannedExpense) => {
    if (plannedExpenseActionRequiresConfirmation("complete_item")) {
      setCompleteItemTarget(item);
      return;
    }
    void updateStatus(item, "completed");
  };

  const reorderWishlistCategory = async (
    targetId: number,
    position: DropPosition,
  ) => {
    if (!isWishlist || wishlistDrag?.type !== "category") return;
    const previousCategories = categories;
    const previousOrder = new Map(
      previousCategories.map((category) => [category.id, category.sort_order]),
    );
    const nextCategories = withSequentialSortOrder(
      moveById(
        sortByManualOrder(previousCategories),
        wishlistDrag.id,
        targetId,
        position,
      ),
    );
    if (
      nextCategories.map((category) => category.id).join(",") ===
      sortByManualOrder(previousCategories)
        .map((category) => category.id)
        .join(",")
    ) {
      setWishlistDrag(null);
      return;
    }

    setCategories(nextCategories);
    setWishlistDrag(null);
    try {
      await Promise.all(
        nextCategories
          .filter(
            (category) => previousOrder.get(category.id) !== category.sort_order,
          )
          .map((category) =>
            api.plannedExpenses.updateCategory(category.id, {
              sort_order: category.sort_order,
            }),
          ),
      );
    } catch (error) {
      setCategories(previousCategories);
      throw error;
    }
  };

  const moveWishlistCategoryByStep = async (
    categoryId: number,
    direction: MoveDirection,
  ) => {
    if (!isWishlist) return;
    const previousCategories = categories;
    const orderedCategories = sortByManualOrder(previousCategories);
    const previousOrder = new Map(
      previousCategories.map((category) => [category.id, category.sort_order]),
    );
    const nextCategories = withSequentialSortOrder(
      moveByStep(orderedCategories, categoryId, direction),
    );
    if (
      nextCategories.map((category) => category.id).join(",") ===
      orderedCategories.map((category) => category.id).join(",")
    ) {
      return;
    }

    setCategories(nextCategories);
    try {
      await Promise.all(
        nextCategories
          .filter(
            (category) => previousOrder.get(category.id) !== category.sort_order,
          )
          .map((category) =>
            api.plannedExpenses.updateCategory(category.id, {
              sort_order: category.sort_order,
            }),
          ),
      );
    } catch (error) {
      setCategories(previousCategories);
      throw error;
    }
  };

  const reorderWishlistItem = async (
    target: PlannedExpense,
    position: DropPosition,
  ) => {
    if (!isWishlist || wishlistDrag?.type !== "item") return;
    const targetCategoryId = target.category_id ?? null;
    if (wishlistDrag.categoryId !== targetCategoryId) {
      setWishlistDrag(null);
      return;
    }

    const previousItems = items;
    const groupItems = sortByManualOrder(
      previousItems.filter(
        (item) => (item.category_id ?? null) === targetCategoryId,
      ),
    );
    const nextGroupItems = withSequentialSortOrder(
      moveById(groupItems, wishlistDrag.id, target.id, position),
    );
    if (
      nextGroupItems.map((item) => item.id).join(",") ===
      groupItems.map((item) => item.id).join(",")
    ) {
      setWishlistDrag(null);
      return;
    }

    const nextGroupItemById = new Map(
      nextGroupItems.map((item) => [item.id, item]),
    );
    setItems((currentItems) =>
      currentItems.map((item) => nextGroupItemById.get(item.id) ?? item),
    );
    setWishlistDrag(null);
    try {
      await Promise.all(
        nextGroupItems
          .filter((item) => {
            const previous = previousItems.find((entry) => entry.id === item.id);
            return previous?.sort_order !== item.sort_order;
          })
          .map((item) =>
            api.plannedExpenses.update(item.id, {
              sort_order: item.sort_order,
            }),
          ),
      );
    } catch (error) {
      setItems(previousItems);
      throw error;
    }
  };

  const moveWishlistItemByStep = async (
    item: PlannedExpense,
    direction: MoveDirection,
  ) => {
    if (!isWishlist) return;
    const targetCategoryId = item.category_id ?? null;
    const previousItems = items;
    const groupItems = sortByManualOrder(
      previousItems.filter(
        (entry) => (entry.category_id ?? null) === targetCategoryId,
      ),
    );
    const nextGroupItems = withSequentialSortOrder(
      moveByStep(groupItems, item.id, direction),
    );
    if (
      nextGroupItems.map((entry) => entry.id).join(",") ===
      groupItems.map((entry) => entry.id).join(",")
    ) {
      return;
    }

    const nextGroupItemById = new Map(
      nextGroupItems.map((entry) => [entry.id, entry]),
    );
    setItems((currentItems) =>
      currentItems.map((entry) => nextGroupItemById.get(entry.id) ?? entry),
    );
    try {
      await Promise.all(
        nextGroupItems
          .filter((entry) => {
            const previous = previousItems.find(
              (current) => current.id === entry.id,
            );
            return previous?.sort_order !== entry.sort_order;
          })
          .map((entry) =>
            api.plannedExpenses.update(entry.id, {
              sort_order: entry.sort_order,
            }),
          ),
      );
    } catch (error) {
      setItems(previousItems);
      throw error;
    }
  };

  const refreshItemMetadata = async (item: PlannedExpense) => {
    await api.plannedExpenses.refreshMetadata(item.id);
    await loadData();
  };

  const getInputAmount = (item: PlannedExpense) => {
    if (isShoppingList && item.estimated_amount <= 0) {
      return item.category_estimated_amount ?? 0;
    }
    return item.estimated_amount;
  };

  const navigateToExpenseInput = (source: PlannedExpenseEntrySource) => {
    navigate("/input", {
      state: {
        tab: "simple",
        plannedExpenseEntry: source,
      },
    });
  };

  const requestExpenseInput = (source: PlannedExpenseEntrySource) => {
    const override = buildPlannedExpenseInputOverride(
      source.amount,
      source.currency,
      selectedCurrency,
      convertCurrency,
      decimalPlacesForCurrency(selectedCurrency),
    );
    if (source.currency !== selectedCurrency && override) {
      setPendingExpenseInput({ ...source, ...override });
      return;
    }
    navigateToExpenseInput(source);
  };

  const startExpenseInput = (
    item: PlannedExpense,
    occurrenceDate?: string | null,
  ) => {
    const effectiveOccurrenceDate = occurrenceDate ?? dueDateForItem(item);
    const completionUpdates =
      effectiveOccurrenceDate != null && item.recurrence_type === "recurring"
        ? plannedExpenseCompleteOccurrenceUpdates(item, effectiveOccurrenceDate)
        : null;
    const source: PlannedExpenseEntrySource = {
      id: item.id,
      kind: item.kind,
      name: item.name,
      amount: getInputAmount(item),
      currency: item.currency,
      recurrenceType: item.recurrence_type,
      expenseAccountId: item.expense_account_id,
      categoryId: item.category_id,
      categoryShoppingPlanType: item.category_shopping_plan_type ?? null,
      occurrenceDate: effectiveOccurrenceDate ?? null,
      nextDueDateAfterOccurrence: completionUpdates?.next_due_date,
      completedDates: completionUpdates?.completed_dates ?? item.completed_dates,
      completionStatusAfterOccurrence: completionUpdates?.status,
    };
    requestExpenseInput(source);
  };

  const skipCalendarPayment = async (
    entry: CalendarDayEntry,
    policy?: PlannedExpenseSkipPolicy,
  ) => {
    const { item, date } = entry;
    if (item.recurrence_type !== "recurring") {
      await api.plannedExpenses.update(item.id, { status: "cancelled" });
      setSelectedCalendarDay(null);
      await loadData();
      return;
    }

    if (policy == null && plannedExpenseHasFixedRecurrenceEnd(item)) {
      setSkipPolicyTarget(entry);
      return;
    }

    const updates = plannedExpenseApplyScheduledSkipPolicy(
      item,
      date,
      policy ?? "reduce",
    );
    await api.plannedExpenses.update(item.id, updates);
    setSelectedCalendarDay((current) =>
      current == null
        ? null
        : {
            ...current,
            entries: current.entries.map((currentEntry) =>
              currentEntry.item.id === item.id && currentEntry.date === date
                ? {
                    ...currentEntry,
                    item: {
                      ...currentEntry.item,
                      ...updates,
                    },
                    skipped: true,
                  }
                : currentEntry,
            ),
          },
    );
    setSkipPolicyTarget(null);
    await loadData();
  };

  const restoreCalendarPayment = async (entry: CalendarDayEntry) => {
    if (entry.skipped) {
      await api.plannedExpenses.update(entry.item.id, {
        skipped_dates: plannedExpenseRemoveSkippedDate(
          entry.item.skipped_dates,
          entry.date,
        ),
      });
    } else {
      await api.plannedExpenses.update(entry.item.id, { status: "open" });
    }
    setSelectedCalendarDay(null);
    await loadData();
  };

  const undoCompletedCalendarPayment = async (entry: CalendarDayEntry) => {
    const updates: {
      status?: PlannedExpenseStatus;
      completed_dates?: string | null;
      next_due_date?: string | null;
    } = {};

    if (entry.completed) {
      updates.completed_dates = plannedExpenseRemoveCompletedDate(
        entry.item.completed_dates,
        entry.date,
      );
    }
    if (entry.item.status === "completed") {
      updates.status = "open";
    }
    if (
      entry.item.recurrence_type === "recurring" &&
      (entry.item.next_due_date == null || entry.date < entry.item.next_due_date)
    ) {
      updates.next_due_date = entry.date;
      updates.status = "open";
    }

    await api.plannedExpenses.update(entry.item.id, updates);
    setSelectedCalendarDay(null);
    await loadData();
  };

  const startShoppingPlanCheckout = (
    category: PlannedExpenseCategory,
    categoryItems: PlannedExpense[],
  ) => {
    if (categoryItems.length === 0) return;
    const source: PlannedExpenseEntrySource = {
      id: categoryItems[0].id,
      kind: "shopping_list",
      name: category.name,
      amount: category.estimated_amount,
      currency: category.currency,
      expenseAccountId: category.default_expense_account_id,
      categoryId: category.id,
      categoryShoppingPlanType: category.shopping_plan_type,
      categoryTargetDate: category.target_date,
      checkoutItemIds: categoryItems.map((item) => item.id),
      checkoutKeepItemIds: categoryItems
        .filter((item) => item.keep_on_routine_clear)
        .map((item) => item.id),
      checkoutItems: categoryItems.map((item) => ({
        id: item.id,
        name: item.name,
        estimatedAmount: item.estimated_amount,
        currency: item.currency,
        status: item.status,
        keepOnRoutineClear: item.keep_on_routine_clear,
        note: item.note,
      })),
    };
    requestExpenseInput(source);
  };

  const activeCurrencyItems = items;
  const referenceCurrencyItems = items.filter(
    (item) => item.currency !== selectedCurrency,
  );
  const sortedItems = useMemo(
    () => {
      if (isShoppingList) {
        return [...items].sort(compareShoppingItems);
      }
      if (isWishlist) {
        return sortByManualOrder(items);
      }
      return [...items].sort(
        (a, b) =>
          statusRank[a.status] - statusRank[b.status] ||
          (dueDateForItem(a) ?? "9999-12-31").localeCompare(
            dueDateForItem(b) ?? "9999-12-31",
          ) ||
          b.id - a.id,
      );
    },
    [isShoppingList, isWishlist, items],
  );
  const todayDate = dayjs().format("YYYY-MM-DD");
  const completedScheduledGroups = useMemo(
    () =>
      isScheduled
        ? plannedExpenseCompletedScheduledGroups(sortedItems, todayDate)
        : [],
    [isScheduled, sortedItems, todayDate],
  );
  const completedScheduledItemIds = useMemo(
    () =>
      new Set(
        completedScheduledGroups.flatMap((group) =>
          group.items.map(({ item }) => item.id),
        ),
      ),
    [completedScheduledGroups],
  );
  const visibleSortedItems = useMemo(() => {
    if (isWishlist) return sortedItems.filter(shouldShowWishlistItemInMainList);
    if (isScheduled) {
      return sortedItems.filter((item) => !completedScheduledItemIds.has(item.id));
    }
    return sortedItems;
  }, [completedScheduledItemIds, isScheduled, isWishlist, sortedItems]);
  const completedWishlistItems = useMemo(
    () =>
      isWishlist
        ? sortedItems.filter(shouldShowWishlistItemInCompletedList)
        : [],
    [isWishlist, sortedItems],
  );
  const sortedShoppingCategories = useMemo(() => {
    if (isWishlist) return sortByManualOrder(categories);
    if (!isShoppingList) return categories;
    return [...categories].sort((a, b) => {
      const aDate = a.target_date;
      const bDate = b.target_date;
      if (aDate && bDate && aDate !== bDate) {
        return aDate.localeCompare(bDate);
      }
      if (aDate !== bDate) {
        const aIsUndated = !aDate;
        return undatedShoppingPlanPosition === "first"
          ? aIsUndated
            ? -1
            : 1
          : aIsUndated
            ? 1
            : -1;
      }
      return (
        a.sort_order - b.sort_order ||
        a.name.localeCompare(b.name) ||
        a.id - b.id
      );
    });
  }, [categories, isShoppingList, isWishlist, undatedShoppingPlanPosition]);

  const groupedCategories = useMemo(() => {
    const groups: ShoppingPlanGroup[] = sortedShoppingCategories.map((category) => ({
      category,
      id: category.id,
      name: category.name,
      items: visibleSortedItems.filter(
        (item) => item.category_id === category.id,
      ),
    }));
    const uncategorizedItems = visibleSortedItems.filter(
      (item) => item.category_id == null,
    );
    if (uncategorizedItems.length > 0 || sortedShoppingCategories.length === 0) {
      groups.push({
        category: null,
        id: null,
        name: noCategoryLabel,
        items: uncategorizedItems,
      });
    }
    return groups;
  }, [noCategoryLabel, visibleSortedItems, sortedShoppingCategories]);

  const completedWishlistGroupedCategories = useMemo(() => {
    if (!isWishlist) return [];
    const groups: ShoppingPlanGroup[] = sortedShoppingCategories.map((category) => ({
      category,
      id: category.id,
      name: category.name,
      items: completedWishlistItems.filter(
        (item) => item.category_id === category.id,
      ),
    }));
    const uncategorizedItems = completedWishlistItems.filter(
      (item) => item.category_id == null,
    );
    if (uncategorizedItems.length > 0) {
      groups.push({
        category: null,
        id: null,
        name: noCategoryLabel,
        items: uncategorizedItems,
      });
    }
    return groups;
  }, [
    completedWishlistItems,
    isWishlist,
    noCategoryLabel,
    sortedShoppingCategories,
  ]);

  const archivedGroupedCategories = useMemo(() => {
    const archivedSortedItems = [...archivedItems].sort(compareShoppingItems);
    const archivedGroups = archivedCategories.map((category) => ({
      category,
      id: category.id,
      name: category.name,
      items: archivedSortedItems.filter(
        (item) => item.category_id === category.id,
      ),
    }));
    return archivedGroups.sort((a, b) => {
      const aCompletedAt = a.category?.archived_at ?? "";
      const bCompletedAt = b.category?.archived_at ?? "";
      return bCompletedAt.localeCompare(aCompletedAt);
    });
  }, [archivedCategories, archivedItems]);

  const openItemCount = activeCurrencyItems.filter(
    (item) => item.status === "open",
  ).length;
  const openTotal = activeCurrencyItems.reduce((sum, item) => {
    if (item.status !== "open") return sum;
    if (isShoppingList) return sum;
    return (
      sum +
      (item.currency === selectedCurrency
        ? item.estimated_amount
        : convertCurrency(
            item.estimated_amount,
            item.currency,
            selectedCurrency,
          ))
    );
  }, 0);
  const calendarWeekStart = normalizeCalendarWeekStart(
    budgetSettings?.calendar_week_start,
  );
  const calendarWeekdayHeaderKeys = useMemo(
    () => calendarWeekdayKeys(calendarWeekStart),
    [calendarWeekStart],
  );
  const calendarDays = useMemo(() => {
    const start = startOfCalendarWeek(
      calendarMonth.startOf("month"),
      calendarWeekStart,
    );
    return Array.from({ length: 42 }, (_, index) => start.add(index, "day"));
  }, [calendarMonth, calendarWeekStart]);
  const todayKey = useMemo(() => dayjs().format("YYYY-MM-DD"), []);
  const calendarEntriesByDate = useMemo(() => {
    const map = new Map<string, CalendarDayEntry[]>();
    const rangeStart = calendarDays[0]?.format("YYYY-MM-DD");
    const rangeEnd = calendarDays.at(-1)?.format("YYYY-MM-DD");
    if (!rangeStart || !rangeEnd) return map;
    for (const item of items) {
      if (!plannedExpenseCalendarShouldShowStatus(item.status)) continue;
      const skippedDates = new Set(
        plannedExpenseSkippedDateList(item.skipped_dates),
      );
      const completedDates = new Set(
        plannedExpenseCompletedDateList(item.completed_dates),
      );
      const addedDates = new Set<string>();
      for (const completedDate of completedDates) {
        if (completedDate < rangeStart || completedDate > rangeEnd) {
          continue;
        }
        const list = map.get(completedDate) ?? [];
        list.push({
          date: completedDate,
          occurrenceNumber: 0,
          item,
          skipped: false,
          completed: true,
        });
        map.set(completedDate, list);
        addedDates.add(completedDate);
      }
      for (const occurrence of plannedExpenseCalendarOccurrences(
        item,
        rangeStart,
        rangeEnd,
      )) {
        if (addedDates.has(occurrence.date)) continue;
        const list = map.get(occurrence.date) ?? [];
        list.push({
          ...occurrence,
          item,
          skipped: skippedDates.has(occurrence.date),
          completed: item.status === "completed",
        });
        map.set(occurrence.date, list);
        addedDates.add(occurrence.date);
      }
      for (const skippedDate of skippedDates) {
        if (
          skippedDate < rangeStart ||
          skippedDate > rangeEnd ||
          addedDates.has(skippedDate)
        ) {
          continue;
        }
        const list = map.get(skippedDate) ?? [];
        list.push({
          date: skippedDate,
          occurrenceNumber: 0,
          item,
          skipped: true,
          completed: false,
        });
        map.set(skippedDate, list);
      }
    }
    return map;
  }, [calendarDays, items]);

  const renderWishlistItemOrderControls = (
    item: PlannedExpense,
    itemIndex: number,
    itemCount: number,
    includeGrip: boolean,
  ) => {
    if (!isWishlist) return null;
    return (
      <Group
        gap={2}
        wrap="nowrap"
        style={{ flex: "0 0 auto" }}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <Tooltip label={t("plannedExpenseMoveUp")} withArrow>
          <ActionIcon
            variant="subtle"
            size="sm"
            aria-label={t("plannedExpenseMoveUp")}
            disabled={itemIndex === 0}
            draggable={false}
            onClick={(event) => {
              event.stopPropagation();
              void moveWishlistItemByStep(item, "up");
            }}
          >
            <IconArrowUp size={14} />
          </ActionIcon>
        </Tooltip>
        <Tooltip label={t("plannedExpenseMoveDown")} withArrow>
          <ActionIcon
            variant="subtle"
            size="sm"
            aria-label={t("plannedExpenseMoveDown")}
            disabled={itemIndex >= itemCount - 1}
            draggable={false}
            onClick={(event) => {
              event.stopPropagation();
              void moveWishlistItemByStep(item, "down");
            }}
          >
            <IconArrowDown size={14} />
          </ActionIcon>
        </Tooltip>
        {includeGrip && (
          <ActionIcon
            variant="subtle"
            size="sm"
            aria-label={t("plannedExpenseReorder")}
            style={{ cursor: "grab", flex: "0 0 auto" }}
          >
            <IconGripVertical size={15} />
          </ActionIcon>
        )}
      </Group>
    );
  };

  const renderItemAmount = (item: PlannedExpense) => {
    const hasEstimatedAmount = !isShoppingList;
    const hasMetadataPrice = item.product_metadata?.price_amount != null;
    if (!hasEstimatedAmount && !hasMetadataPrice) return null;
    return (
      <Stack gap={0} align="flex-end">
        {hasEstimatedAmount && (
          <>
            <Text fw={800} size="sm">
              {formatCurrency(item.estimated_amount, locale, item.currency)}
            </Text>
            <ReferenceAmount
              amount={item.estimated_amount}
              sourceCurrency={item.currency}
              selectedCurrency={selectedCurrency}
              convertCurrency={convertCurrency}
              locale={locale}
              t={t}
            />
          </>
        )}
        {hasMetadataPrice && (
          <>
            <Text size="xs" c="dimmed">
              {t("productMetadataPrice")}{" "}
              {formatCurrency(
                item.product_metadata!.price_amount!,
                locale,
                item.product_metadata!.currency,
              )}
            </Text>
            <ReferenceAmount
              amount={item.product_metadata!.price_amount!}
              sourceCurrency={item.product_metadata!.currency}
              selectedCurrency={selectedCurrency}
              convertCurrency={convertCurrency}
              locale={locale}
              t={t}
            />
          </>
        )}
      </Stack>
    );
  };

  const renderItemActions = (
    item: PlannedExpense,
    wrap: "wrap" | "nowrap" = "nowrap",
  ) => (
    <Group gap={4} wrap={wrap} justify="flex-end">
      {item.url && (
        <ActionIcon
          variant="subtle"
          color="blue"
          aria-label={t("productMetadataRefresh")}
          onClick={() => void refreshItemMetadata(item)}
        >
          <IconRefresh size={16} />
        </ActionIcon>
      )}
      {item.status === "open" && (
        <Tooltip label={t("plannedExpenseInputExpense")} withArrow>
          <ActionIcon
            variant="subtle"
            color={pageColor}
            aria-label={t("plannedExpenseInputExpense")}
            onClick={() => startExpenseInput(item)}
          >
            <IconCheck size={16} />
          </ActionIcon>
        </Tooltip>
      )}
      {!isShoppingList && item.status !== "completed" && (
        <Tooltip label={t("plannedExpenseForceComplete")} withArrow>
          <ActionIcon
            variant="subtle"
            color="orange"
            aria-label={t("plannedExpenseForceComplete")}
            onClick={() => requestCompleteItem(item)}
          >
            <IconAlertTriangle size={16} />
          </ActionIcon>
        </Tooltip>
      )}
      <ActionIcon
        variant="subtle"
        aria-label={t("editLabel")}
        onClick={() => openEditModal(item)}
      >
        <IconEdit size={16} />
      </ActionIcon>
      <Tooltip label={t("deleteBudgetCategory")} withArrow>
        <ActionIcon
          variant="subtle"
          color="red"
          aria-label={t("deleteBudgetCategory")}
          onClick={() => requestDeleteItem(item)}
        >
          <IconTrash size={16} />
        </ActionIcon>
      </Tooltip>
    </Group>
  );

  return (
    <Stack gap="lg">
      <Group gap="sm">
        <Button
          component={Link}
          to="/"
          variant="subtle"
          size="xs"
          leftSection={<IconArrowLeft size={14} />}
        >
          {t("navOverview")}
        </Button>
      </Group>

      <Group justify="space-between" align="flex-start">
        <Group gap="sm" align="flex-start">
          <ThemeIcon size={42} radius="md" color={pageColor} variant="light">
            <Icon size={23} />
          </ThemeIcon>
          <Box>
            <Text fw={800} size="xl">
              {pageTitle}
            </Text>
            <Text size="sm" c="dimmed">
              {pageDescription}
            </Text>
          </Box>
        </Group>
        <Group gap="xs">
          <Button variant="light" onClick={openCreateCategoryModal}>
            {categoryAddLabel}
          </Button>
          {!isShoppingList && (
            <Button
              leftSection={<IconPlus size={16} />}
              onClick={() => openCreateModal()}
            >
              {t("plannedExpenseAdd")}
            </Button>
          )}
        </Group>
      </Group>

      {!isShoppingList && (
        <Paper withBorder px="md" py="xs" radius="md">
          <Group gap="md" wrap="wrap">
            <Group gap={6} wrap="nowrap">
              <Text size="xs" c="dimmed" fw={700}>
                {t("plannedExpenseOpenCount")}
              </Text>
              <Text fw={800} size="sm">
                {openItemCount}
              </Text>
            </Group>
            <Divider orientation="vertical" />
            <Group gap={6} wrap="nowrap">
              <Text size="xs" c="dimmed" fw={700}>
                {t("plannedExpenseOpenTotal")}
              </Text>
              <Text fw={800} size="sm">
                {formatCurrency(openTotal, locale, selectedCurrency)}
              </Text>
            </Group>
          </Group>
        </Paper>
      )}

      {isScheduled && (
        <Paper withBorder p={calendarLayout.calendarPadding} radius="md">
          <Group
            justify="space-between"
            mb="sm"
            gap="xs"
            wrap="wrap"
            px={isCalendarCompact ? 4 : 0}
            pt={isCalendarCompact ? 4 : 0}
          >
            <Text fw={700} size="sm">
              {t("plannedExpenseCalendar")}
            </Text>
            <Group gap={isCalendarCompact ? 4 : "xs"} wrap="nowrap">
              <ActionIcon
                variant="subtle"
                size={isCalendarCompact ? "sm" : "md"}
                onClick={() => setCalendarMonth((month) => month.subtract(1, "month"))}
                aria-label="Previous month"
              >
                <IconChevronLeft size={16} />
              </ActionIcon>
              <Text
                fw={700}
                size={isCalendarCompact ? "xs" : "sm"}
                w={isCalendarCompact ? 70 : 92}
                ta="center"
              >
                {calendarMonth.format("YYYY/MM")}
              </Text>
              <Button
                size="xs"
                variant="light"
                px={isCalendarCompact ? 6 : undefined}
                onClick={() => setCalendarMonth(dayjs().startOf("month"))}
              >
                {t("calendarTodayButton")}
              </Button>
              <ActionIcon
                variant="subtle"
                size={isCalendarCompact ? "sm" : "md"}
                onClick={() => setCalendarMonth((month) => month.add(1, "month"))}
                aria-label="Next month"
              >
                <IconChevronRight size={16} />
              </ActionIcon>
            </Group>
          </Group>
          <SimpleGrid
            cols={7}
            spacing={calendarLayout.gridGap}
            mb={calendarLayout.gridGap}
          >
            {calendarWeekdayHeaderKeys.map((key, index) => (
              <Text
                key={key}
                size={isCalendarCompact ? "10px" : "xs"}
                c={calendarWeekdayColor((calendarWeekStart + index) % 7)}
                fw={800}
                ta="center"
                py={isCalendarCompact ? 1 : 2}
              >
                {t(key)}
              </Text>
            ))}
          </SimpleGrid>
          <SimpleGrid cols={7} spacing={calendarLayout.gridGap}>
            {calendarDays.map((date) => {
              const dateKey = date.format("YYYY-MM-DD");
              const isToday = isCalendarToday(dateKey, todayKey);
              const dayEntries = calendarEntriesByDate.get(dateKey) ?? [];
              const primaryTotal = calendarPrimaryTotal(
                dayEntries,
                selectedCurrency,
                convertCurrency,
              );
              const dayBackground =
                plannedExpenseCalendarDayBackground(dayEntries);
              const hasCompletedEntry =
                plannedExpenseCalendarDayHasCompleted(dayEntries);
              const hasSkippedEntry =
                plannedExpenseCalendarDayHasSkipped(dayEntries);
              const content = (
                <Box
                  p={calendarLayout.cellPadding}
                  mih={calendarLayout.cellMinHeight}
                  style={{
                    border: "1px solid var(--mantine-color-default-border)",
                    borderRadius: isCalendarCompact ? 0 : 6,
                    backgroundColor: dayBackground === "completed"
                      ? "var(--mantine-color-green-light)"
                      : dayBackground === "skipped"
                        ? "var(--mantine-color-gray-light)"
                      : isToday
                        ? "var(--mantine-color-yellow-light)"
                        : undefined,
                    boxShadow: dayBackground == null && isToday
                      ? "inset 0 0 0 1px var(--mantine-color-yellow-6)"
                      : undefined,
                    opacity: date.month() === calendarMonth.month() ? 1 : 0.42,
                    position: "relative",
                  }}
                >
                  {(hasCompletedEntry || hasSkippedEntry) && (
                    <Group
                      gap={1}
                      style={{
                        position: "absolute",
                        top: isCalendarCompact ? 1 : 4,
                        right: isCalendarCompact ? 1 : 4,
                        pointerEvents: "none",
                      }}
                    >
                      {hasCompletedEntry && (
                        <ThemeIcon
                          size={isCalendarCompact ? 14 : 16}
                          radius="xl"
                          color="green"
                          variant="filled"
                        >
                          <IconCheck size={isCalendarCompact ? 9 : 11} />
                        </ThemeIcon>
                      )}
                      {hasSkippedEntry && (
                        <ThemeIcon
                          size={isCalendarCompact ? 14 : 16}
                          radius="xl"
                          color="gray"
                          variant="white"
                        >
                          <IconPlayerTrackNext
                            size={isCalendarCompact ? 9 : 11}
                          />
                        </ThemeIcon>
                      )}
                    </Group>
                  )}
                  <Text
                    size={isCalendarCompact ? "10px" : "xs"}
                    c={
                      dayBackground === "completed"
                        ? "green.9"
                        : dayBackground === "skipped"
                          ? "gray.8"
                        : isToday
                          ? "yellow.9"
                          : calendarWeekdayColor(date.day())
                    }
                    fw={isToday || dayBackground != null ? 900 : 700}
                    lh={1.1}
                  >
                    {date.date()}
                  </Text>
                  {dayEntries.length > 0 && primaryTotal != null && (
                    <Stack
                      gap={calendarLayout.showItemNames ? 2 : 0}
                      mt={isCalendarCompact ? 1 : 2}
                    >
                      <Text
                        size={isCalendarCompact ? "8px" : "xs"}
                        fw={700}
                        c="blue"
                        lineClamp={1}
                        lh={1}
                        mx={calendarLayout.amountMarginInline}
                        px={0}
                        ta={calendarLayout.amountTextAlign}
                        style={{
                          fontVariantNumeric: "tabular-nums",
                          letterSpacing: 0,
                        }}
                      >
                        {formatCompactCurrency(
                          primaryTotal.amount,
                          locale,
                          primaryTotal.currency,
                        )}
                      </Text>
                      {calendarLayout.showItemNames ? (
                        <Text
                          size="xs"
                          lineClamp={2}
                          ta={calendarLayout.itemTextAlign}
                        >
                          {dayEntries.map((entry) => entry.item.name).join(", ")}
                        </Text>
                      ) : dayEntries.length > 1 ? (
                        <Badge size="xs" variant="light" px={3}>
                          {dayEntries.length}
                        </Badge>
                      ) : null}
                    </Stack>
                  )}
                </Box>
              );
              if (dayEntries.length === 0) {
                return <Box key={dateKey}>{content}</Box>;
              }
              return (
                <UnstyledButton
                  key={dateKey}
                  aria-label={`${dateKey} ${t("plannedExpensePaymentDetails")}`}
                  aria-current={isToday ? "date" : undefined}
                  onClick={() =>
                    setSelectedCalendarDay({
                      date: dateKey,
                      entries: dayEntries,
                    })
                  }
                  style={{ display: "block", width: "100%", textAlign: "left" }}
                >
                  {content}
                </UnstyledButton>
              );
            })}
          </SimpleGrid>
        </Paper>
      )}

      <Modal
        opened={
          selectedCalendarDay != null && selectedCalendarDay.entries.length > 0
        }
        onClose={() => setSelectedCalendarDay(null)}
        title={
          selectedCalendarDay
            ? `${selectedCalendarDay.date} ${t("plannedExpensePaymentDetails")}`
            : t("plannedExpensePaymentDetails")
        }
        centered
        size="lg"
      >
        {selectedCalendarDay && (
          <Stack gap="md">
            <Stack gap="xs">
              {selectedCalendarDay.entries.map((entry) => (
                <Paper
                  key={`${entry.item.id}-${entry.date}`}
                  withBorder
                  p="sm"
                  radius="sm"
                >
                  <Group justify="space-between" align="flex-start" gap="sm">
                    <Box style={{ minWidth: 0, flex: 1 }}>
                      <Text fw={700} size="sm" lineClamp={1}>
                        {entry.item.name}
                      </Text>
                      <Text size="xs" c="dimmed">
                        {t("plannedExpenseFrequency")}:{" "}
                        {recurrenceFrequencyLabel(entry.item, t)}
                      </Text>
                      <Text size="xs" c="dimmed">
                        {t("plannedExpenseOccurrenceNumber")}:{" "}
                        {entry.occurrenceNumber > 0 ? entry.occurrenceNumber : "-"}
                      </Text>
                    </Box>
                    <Group gap="xs" wrap="nowrap">
                      <Stack gap={0} align="flex-end">
                        <Text fw={800} size="sm" style={{ whiteSpace: "nowrap" }}>
                          {formatCurrency(
                            plannedExpenseCalendarEntryAmount(entry),
                            locale,
                            entry.item.currency,
                          )}
                        </Text>
                        <ReferenceAmount
                          amount={plannedExpenseCalendarEntryAmount(entry)}
                          sourceCurrency={entry.item.currency}
                          selectedCurrency={selectedCurrency}
                          convertCurrency={convertCurrency}
                          locale={locale}
                          t={t}
                        />
                      </Stack>
                      {entry.skipped || entry.item.status === "cancelled" ? (
                        <Tooltip label={t("shoppingPlanRestore")} withArrow>
                          <ActionIcon
                            size="sm"
                            variant="light"
                            color="teal"
                            aria-label={t("shoppingPlanRestore")}
                            onClick={() => void restoreCalendarPayment(entry)}
                          >
                            <IconRefresh size={15} />
                          </ActionIcon>
                        </Tooltip>
                      ) : entry.completed || entry.item.status === "completed" ? (
                        <Tooltip label={t("plannedExpenseUndoCompletion")} withArrow>
                          <ActionIcon
                            size="sm"
                            variant="light"
                            color="green"
                            aria-label={t("plannedExpenseUndoCompletion")}
                            onClick={() =>
                              void undoCompletedCalendarPayment(entry)
                            }
                          >
                            <IconRefresh size={15} />
                          </ActionIcon>
                        </Tooltip>
                      ) : (
                        <>
                          <Tooltip label={t("plannedExpenseEnterPayment")} withArrow>
                            <ActionIcon
                              size="sm"
                              variant="light"
                              color="teal"
                              aria-label={t("plannedExpenseEnterPayment")}
                              onClick={() =>
                                startExpenseInput(entry.item, entry.date)
                              }
                            >
                              <IconReceipt size={15} />
                            </ActionIcon>
                          </Tooltip>
                          <Tooltip label={t("plannedExpenseSkipPayment")} withArrow>
                            <ActionIcon
                              size="sm"
                              variant="subtle"
                              color="gray"
                              aria-label={t("plannedExpenseSkipPayment")}
                              onClick={() => void skipCalendarPayment(entry)}
                            >
                              <IconX size={15} />
                            </ActionIcon>
                          </Tooltip>
                        </>
                      )}
                    </Group>
                  </Group>
                </Paper>
              ))}
            </Stack>
            <Divider />
            <Group justify="space-between">
              <Text fw={800}>{t("plannedExpensePaymentDetailsTotal")}</Text>
              <Stack gap={2} align="flex-end">
                {Array.from(
                  calendarTotalsByCurrency(selectedCalendarDay.entries),
                ).map(([currency, amount]) => (
                  <Text key={currency} fw={800}>
                    {formatCurrency(amount, locale, currency)}
                  </Text>
                ))}
                {selectedCalendarDay.entries.some(
                  (entry) => entry.item.currency !== selectedCurrency,
                ) && (
                  <Text size="xs" c="dimmed" fw={700}>
                    {t("plannedExpenseReferenceAmount")}: {" "}
                    {formatCurrency(
                      selectedCalendarDay.entries.reduce((sum, entry) => {
                        const amount = plannedExpenseCalendarEntryAmount(entry);
                        return (
                          sum +
                          (entry.item.currency === selectedCurrency
                            ? amount
                            : convertCurrency(
                                amount,
                                entry.item.currency,
                                selectedCurrency,
                              ))
                        );
                      }, 0),
                      locale,
                      selectedCurrency,
                    )}
                  </Text>
                )}
              </Stack>
            </Group>
          </Stack>
        )}
      </Modal>

      <Modal
        opened={skipPolicyTarget != null}
        onClose={() => setSkipPolicyTarget(null)}
        title={t("plannedExpenseSkipPolicyTitle")}
        centered
      >
        <Stack gap="md">
          <Text size="sm">{t("plannedExpenseSkipPolicyMessage")}</Text>
          <Group justify="flex-end" gap="xs">
            <Button
              variant="light"
              onClick={() => {
                if (skipPolicyTarget) {
                  void skipCalendarPayment(skipPolicyTarget, "postpone");
                }
              }}
            >
              {t("plannedExpenseSkipPolicyPostpone")}
            </Button>
            <Button
              variant="filled"
              color="gray"
              onClick={() => {
                if (skipPolicyTarget) {
                  void skipCalendarPayment(skipPolicyTarget, "reduce");
                }
              }}
            >
              {t("plannedExpenseSkipPolicyReduce")}
            </Button>
          </Group>
        </Stack>
      </Modal>

      {isShoppingList ? (
        <Stack gap="lg">
          <Group justify="flex-end" gap="xs">
            <Switch
              size="sm"
              checked={undatedShoppingPlanPosition === "first"}
              onChange={(event) =>
                handleUndatedShoppingPlanPositionChange(
                  event.currentTarget.checked ? "first" : "last",
                )
              }
              label={t("shoppingPlanUndatedFirstToggle")}
            />
          </Group>
          <ShoppingPlanList
            loading={loading}
            isEmpty={items.length === 0 && categories.length === 0}
            groups={groupedCategories}
            t={t}
            locale={locale}
            selectedCurrency={selectedCurrency}
            convertCurrency={convertCurrency}
            accountNameById={accountNameById}
            inlineDraft={inlineShoppingItemDraft}
            categoryEmptyLabel={categoryEmptyLabel}
            onOpenAddItem={openInlineShoppingItem}
            onInlineNameChange={updateInlineShoppingItemName}
            onInlineKeepOnClearChange={updateInlineShoppingItemKeepOnClear}
            onInlineSave={() => void saveInlineShoppingItem()}
            onInlineCancel={() => setInlineShoppingItemDraft(null)}
            onCompletePlan={(category) => void completeCategory(category)}
            onCheckoutPlan={startShoppingPlanCheckout}
            onEditPlan={openEditCategoryModal}
            onDeletePlan={requestDeleteCategory}
            onToggleItem={(item, checked) =>
              void updateStatus(item, checked ? "completed" : "open")
            }
            onEditItem={openEditModal}
            onDeleteItem={requestDeleteItem}
          />
          <ArchivedShoppingPlanList
            groups={archivedGroupedCategories}
            t={t}
            locale={locale}
            selectedCurrency={selectedCurrency}
            convertCurrency={convertCurrency}
            accountNameById={accountNameById}
            onRestorePlan={setRestoreShoppingPlanTarget}
            onRestoreItem={(group, item) =>
              void restoreArchivedShoppingItem(group, item)
            }
          />
        </Stack>
      ) : (
      <Stack gap="md">
      <Paper withBorder radius="md" style={{ overflow: "hidden" }}>
        <Group justify="space-between" px="md" py="sm">
          <Text fw={700} size="sm">
            {t("plannedExpenseList")}
          </Text>
          <Group gap="xs">
            {referenceCurrencyItems.length > 0 && (
              <Badge variant="outline" color="gray">
                {t("plannedExpenseReferenceCurrency")}{" "}
                {referenceCurrencyItems.length}
              </Badge>
            )}
          </Group>
        </Group>
        <Divider />
        {loading ? (
          <Stack p="md">
            <Skeleton height={64} />
            <Skeleton height={64} />
            <Skeleton height={64} />
          </Stack>
        ) : items.length === 0 && categories.length === 0 ? (
          <Center py="xl">
            <Stack gap="xs" align="center">
              <Icon size={36} color="var(--mantine-color-dimmed)" />
              <Text size="sm" c="dimmed">
                {t("plannedExpenseEmpty")}
              </Text>
            </Stack>
          </Center>
        ) : (
          <Stack gap={0}>
            {groupedCategories.map((group) => {
              const openItems = group.items.filter((item) => item.status === "open");
              const groupTotal = isShoppingList
                ? group.category?.estimated_amount ?? 0
                : group.items.reduce(
                    (sum, item) =>
                      sum +
                      (item.currency === selectedCurrency
                        ? item.estimated_amount
                        : convertCurrency(
                            item.estimated_amount,
                            item.currency,
                            selectedCurrency,
                          )),
                    0,
                  );
              const categoryDefaultExpenseAccount =
                isShoppingList && group.category?.default_expense_account_id != null
                  ? accounts.find(
                      (account) =>
                        account.id === group.category!.default_expense_account_id,
                    )
                  : null;
              const isAddingInlineShoppingItem =
                isShoppingList &&
                group.category != null &&
                inlineShoppingItemDraft?.categoryId === group.category.id;
              const groupBadgeSize = isShoppingList ? "sm" : "xs";
              const shoppingPlanDate =
                isShoppingList && group.category?.target_date
                  ? dayjs(group.category.target_date).format("YYYY/MM/DD")
                  : null;
              const wishlistCategoryOrder = isWishlist
                ? sortByManualOrder(categories)
                : [];
              const wishlistCategoryIndex = group.category
                ? wishlistCategoryOrder.findIndex(
                    (category) => category.id === group.category!.id,
                  )
                : -1;
              return (
                <Box
                  key={group.id ?? "__none"}
                  onDragOver={(event) => {
                    if (isWishlist && wishlistDrag?.type === "category") {
                      event.preventDefault();
                    }
                  }}
                  onDrop={(event) => {
                    if (isWishlist && group.category) {
                      event.preventDefault();
                      void reorderWishlistCategory(
                        group.category.id,
                        getDropPosition(event),
                      );
                    }
                  }}
                  onDragEnd={() => setWishlistDrag(null)}
                >
                  <Group
                    justify="space-between"
                    px="md"
                    py={isShoppingList ? "sm" : "xs"}
                    bg="var(--mantine-color-default-hover)"
                    draggable={isWishlist && group.category != null}
                    onDragStart={() => {
                      if (isWishlist && group.category) {
                        setWishlistDrag({
                          type: "category",
                          id: group.category.id,
                        });
                      }
                    }}
                  >
                    <Group gap={isShoppingList ? "sm" : "xs"}>
                      {isWishlist && group.category && (
                        <Group
                          gap={2}
                          wrap="nowrap"
                          style={{ flex: "0 0 auto" }}
                          onPointerDown={(event) => event.stopPropagation()}
                        >
                          <Tooltip label={t("plannedExpenseMoveUp")} withArrow>
                            <ActionIcon
                              variant="subtle"
                              size="sm"
                              aria-label={t("plannedExpenseMoveUp")}
                              disabled={wishlistCategoryIndex <= 0}
                              draggable={false}
                              onClick={(event) => {
                                event.stopPropagation();
                                void moveWishlistCategoryByStep(
                                  group.category!.id,
                                  "up",
                                );
                              }}
                            >
                              <IconArrowUp size={14} />
                            </ActionIcon>
                          </Tooltip>
                          <Tooltip label={t("plannedExpenseMoveDown")} withArrow>
                            <ActionIcon
                              variant="subtle"
                              size="sm"
                              aria-label={t("plannedExpenseMoveDown")}
                              disabled={
                                wishlistCategoryIndex < 0 ||
                                wishlistCategoryIndex >=
                                  wishlistCategoryOrder.length - 1
                              }
                              draggable={false}
                              onClick={(event) => {
                                event.stopPropagation();
                                void moveWishlistCategoryByStep(
                                  group.category!.id,
                                  "down",
                                );
                              }}
                            >
                              <IconArrowDown size={14} />
                            </ActionIcon>
                          </Tooltip>
                          <ActionIcon
                            variant="subtle"
                            size="sm"
                            aria-label={t("plannedExpenseReorder")}
                            style={{ cursor: "grab", flex: "0 0 auto" }}
                          >
                            <IconGripVertical size={15} />
                          </ActionIcon>
                        </Group>
                      )}
                      {shoppingPlanDate && (
                        <Group gap={4} wrap="nowrap">
                          {group.category?.shopping_plan_type === "routine" && (
                            <IconRefresh
                              size={15}
                              color="var(--mantine-color-dimmed)"
                            />
                          )}
                          <Text fw={600} size="sm" c="dimmed">
                            {shoppingPlanDate}
                          </Text>
                        </Group>
                      )}
                      <Text fw={700} size={isShoppingList ? "md" : "sm"}>
                        {group.name}
                      </Text>
                      {group.category && (
                        <Badge size="xs" variant="outline" color="gray">
                          {group.category.currency}
                        </Badge>
                      )}
                      <Badge size={groupBadgeSize} variant="light" color={pageColor}>
                        {formatCurrency(groupTotal, locale, selectedCurrency)}
                      </Badge>
                      {categoryDefaultExpenseAccount && (
                        <Badge size={groupBadgeSize} variant="light" color="blue">
                          {accountDisplayName(categoryDefaultExpenseAccount, t)}
                        </Badge>
                      )}
                    </Group>
                    <Group gap={4}>
                      {!isShoppingList && group.category && (
                        <Tooltip label={t("plannedExpenseAdd")} withArrow>
                          <ActionIcon
                            variant="subtle"
                            color={pageColor}
                            aria-label={t("plannedExpenseAdd")}
                            draggable={false}
                            onClick={(event) => {
                              event.stopPropagation();
                              openCreateModal(group.category!.id);
                            }}
                          >
                            <IconPlus size={15} />
                          </ActionIcon>
                        </Tooltip>
                      )}
                      {isShoppingList && group.category && (
                        <Button
                          size="xs"
                          variant="subtle"
                          leftSection={<IconPlus size={14} />}
                          onClick={() => {
                            if (group.category) {
                              openInlineShoppingItem(group.category.id);
                            }
                          }}
                        >
                          {t("plannedExpenseAdd")}
                        </Button>
                      )}
                      {isShoppingList && openItems.length > 0 && (
                        <Button
                          size="xs"
                          variant="subtle"
                          leftSection={<IconCheck size={14} />}
                          onClick={() =>
                            void completeCategory(group.category ?? null)
                          }
                        >
                          {group.category?.shopping_plan_type === "routine"
                            ? t("shoppingPlanClearItems")
                            : t("plannedExpenseCompleteCategory")}
                        </Button>
                      )}
                      {group.category && (
                        <>
                          <ActionIcon
                            variant="subtle"
                            aria-label={t("editLabel")}
                            onClick={() => openEditCategoryModal(group.category!)}
                          >
                            <IconEdit size={15} />
                          </ActionIcon>
                          <ActionIcon
                            variant="subtle"
                            color="red"
                            aria-label={t("deleteBudgetCategory")}
                            onClick={() => requestDeleteCategory(group.category!)}
                          >
                            <IconTrash size={15} />
                          </ActionIcon>
                        </>
                      )}
                    </Group>
                  </Group>
                  {isAddingInlineShoppingItem && (
                    <Box
                      px="md"
                      py="sm"
                      style={{
                        borderBottom:
                          "1px solid var(--mantine-color-default-border)",
                      }}
                    >
                      <Group gap="xs" align="flex-start" wrap="nowrap">
                        <TextInput
                          autoFocus
                          size="sm"
                          placeholder={t("plannedExpenseName")}
                          value={inlineShoppingItemDraft.name}
                          error={inlineShoppingItemDraft.error}
                          onChange={(event) =>
                            updateInlineShoppingItemName(
                              event.currentTarget.value,
                            )
                          }
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              void saveInlineShoppingItem();
                            }
                            if (event.key === "Escape") {
                              setInlineShoppingItemDraft(null);
                            }
                          }}
                          style={{ flex: 1 }}
                        />
                        <Button
                          size="sm"
                          leftSection={<IconCheck size={14} />}
                          loading={inlineShoppingItemDraft.saving}
                          disabled={!inlineShoppingItemDraft.name.trim()}
                          onClick={() => void saveInlineShoppingItem()}
                        >
                          {t("save")}
                        </Button>
                        <ActionIcon
                          size="lg"
                          variant="subtle"
                          aria-label={t("cancel")}
                          onClick={() => setInlineShoppingItemDraft(null)}
                        >
                          <IconX size={16} />
                        </ActionIcon>
                      </Group>
                    </Box>
                  )}
                  {group.items.length === 0 ? (
                    isAddingInlineShoppingItem ? null : (
                    <Text size="sm" c="dimmed" px="md" py="sm">
                      {categoryEmptyLabel}
                    </Text>
                    )
                  ) : (
                    group.items.map((item, itemIndex) => {
                      const isReferenceCurrency = item.currency !== selectedCurrency;
                      return (
                        <Box
                          key={item.id}
                          px="md"
                          py="sm"
                          draggable={isWishlist}
                          onDragStart={(event) => {
                            if (isWishlist) {
                              event.stopPropagation();
                              setWishlistDrag({
                                type: "item",
                                id: item.id,
                                categoryId: item.category_id ?? null,
                              });
                            }
                          }}
                          onDragOver={(event) => {
                            if (
                              isWishlist &&
                              wishlistDrag?.type === "item" &&
                              wishlistDrag.categoryId ===
                                (item.category_id ?? null)
                            ) {
                              event.preventDefault();
                            }
                          }}
                          onDrop={(event) => {
                            if (isWishlist) {
                              event.preventDefault();
                              void reorderWishlistItem(
                                item,
                                getDropPosition(event),
                              );
                            }
                          }}
                          onDragEnd={() => setWishlistDrag(null)}
                          style={{
                            borderBottom:
                              "1px solid var(--mantine-color-default-border)",
                          }}
                        >
                          <Group
                            justify="space-between"
                            align="flex-start"
                            gap="sm"
                            wrap="nowrap"
                          >
                            <Group gap="sm" align="flex-start" wrap="nowrap" style={{ minWidth: 0, flex: 1 }}>
                              {isShoppingList && (
                                <Checkbox
                                  mt={2}
                                  checked={item.status === "completed"}
                                  onChange={(event) =>
                                    void updateStatus(
                                      item,
                                      event.currentTarget.checked
                                        ? "completed"
                                        : "open",
                                    )
                                  }
                                  aria-label={t("plannedExpenseComplete")}
                                />
                              )}
                              {isWishlist && (
                                <Box visibleFrom="sm" style={{ flex: "0 0 auto" }}>
                                  {renderWishlistItemOrderControls(
                                    item,
                                    itemIndex,
                                    group.items.length,
                                    true,
                                  )}
                                </Box>
                              )}
                              <Box style={{ minWidth: 0, flex: 1 }}>
                                <Text
                                  fw={700}
                                  size="sm"
                                  lineClamp={itemNameLineClamp}
                                  style={{ wordBreak: "break-word" }}
                                >
                                  {item.name}
                                </Text>
                                <Group gap={4} mt={4} mb={4} wrap="wrap">
                                  {isReferenceCurrency && (
                                    <Badge size="xs" color="gray" variant="outline">
                                      {t("plannedExpenseReferenceCurrency")}
                                    </Badge>
                                  )}
                                </Group>
                                <Text size="xs" c="dimmed" lineClamp={1}>
                                  {item.expense_account_name ??
                                    t("plannedExpenseNoExpenseAccount")}
                                  {!isShoppingList && dueDateForItem(item)
                                    ? ` / ${dueDateForItem(item)}`
                                    : ""}
                                  {item.recurrence_type === "recurring"
                                    ? ` / ${t("plannedExpenseRecurring")}`
                                    : ""}
                                </Text>
                                {(item.note || item.url) && (
                                  <Text size="xs" c="dimmed" lineClamp={1} mt={2}>
                                    {item.note || item.url}
                                  </Text>
                                )}
                                {item.product_metadata && (
                                  <Group gap="xs" mt={5}>
                                    <Badge size="xs" variant="light">
                                      {t(
                                        `productSource_${item.product_metadata.source_site}`,
                                      )}
                                    </Badge>
                                    <Badge
                                      size="xs"
                                      color={availabilityColor(
                                        item.product_metadata.availability_status,
                                      )}
                                      variant="light"
                                    >
                                      {t(
                                        `productAvailability_${item.product_metadata.availability_status}`,
                                      )}
                                    </Badge>
                                    {item.product_metadata.expires_at && (
                                      <Text size="xs" c="dimmed">
                                        {t("productMetadataFetched")}{" "}
                                        {dayjs(
                                          item.product_metadata.fetched_at,
                                        ).format("M/D H:mm")}
                                      </Text>
                                    )}
                                  </Group>
                                )}
                              </Box>
                            </Group>
                            <Stack
                              gap={4}
                              align="flex-end"
                              visibleFrom="sm"
                              style={{ flex: "0 0 auto" }}
                            >
                              {renderItemAmount(item)}
                              {renderItemActions(item)}
                            </Stack>
                          </Group>
                          <Stack hiddenFrom="sm" gap={6} mt="xs">
                            {(isWishlist ||
                              !isShoppingList ||
                              item.product_metadata?.price_amount != null) && (
                              <Group
                                justify="space-between"
                                align="center"
                                gap="xs"
                              >
                                {renderWishlistItemOrderControls(
                                  item,
                                  itemIndex,
                                  group.items.length,
                                  false,
                                )}
                                {renderItemAmount(item)}
                              </Group>
                            )}
                            {renderItemActions(item, "wrap")}
                          </Stack>
                        </Box>
                      );
                    })
                  )}
                </Box>
              );
            })}
          </Stack>
        )}
      </Paper>
      {isWishlist && (
        <CompletedWishlistList
          groups={completedWishlistGroupedCategories}
          t={t}
          locale={locale}
          selectedCurrency={selectedCurrency}
          convertCurrency={convertCurrency}
          pageColor={pageColor}
          onReopenItem={(item) => void updateStatus(item, "open")}
          onEditItem={openEditModal}
          onDeleteItem={requestDeleteItem}
        />
      )}
      {isScheduled && (
        <CompletedScheduledPaymentList
          groups={completedScheduledGroups}
          t={t}
          locale={locale}
          selectedCurrency={selectedCurrency}
          convertCurrency={convertCurrency}
          onReopenItem={(item) => void updateStatus(item, "open")}
          onEditItem={openEditModal}
          onDeleteItem={requestDeleteItem}
        />
      )}
      </Stack>
      )}

      <Modal
        opened={categoryModalOpen}
        onClose={() => setCategoryModalOpen(false)}
        title={categoryLabel}
      >
        <form onSubmit={submitCategoryForm}>
          <Stack gap="sm">
            <TextInput
              label={categoryNameLabel}
              {...categoryForm.getInputProps("name")}
            />
            <Select
              label={t("currencyLabel")}
              data={currencyOptions}
              allowDeselect={false}
              disabled={editingCategoryHasItems}
              {...categoryForm.getInputProps("currency")}
            />
            {isShoppingList && (
              <>
                <NumberInput
                  label={categoryEstimateLabel}
                  min={0}
                  decimalScale={categoryCurrencyDecimalPlaces}
                  {...categoryForm.getInputProps("estimated_amount")}
                />
                <Select
                  label={t("shoppingPlanType")}
                  data={shoppingPlanTypeOptions}
                  allowDeselect={false}
                  {...categoryForm.getInputProps("shopping_plan_type")}
                />
                <DatePickerInput
                  label={t(
                    categoryForm.values.shopping_plan_type === "routine"
                      ? "shoppingPlanNextTargetDate"
                      : "plannedExpenseTargetDate",
                  )}
                  clearable
                  valueFormat={locale === "ja" ? "YYYY/M/D" : "MMM D, YYYY"}
                  {...categoryForm.getInputProps("target_date")}
                />
                <Text size="xs" c="dimmed">
                  {t(
                    categoryForm.values.shopping_plan_type === "routine"
                      ? "shoppingPlanTypeRoutineHelp"
                      : "shoppingPlanTypeOneTimeHelp",
                  )}
                </Text>
                <Select
                  label={t("plannedExpenseDefaultExpenseAccount")}
                  data={expenseAccountOptions}
                  clearable
                  searchable
                  renderOption={renderAccountOption as never}
                  {...categoryForm.getInputProps("default_expense_account_id")}
                />
              </>
            )}
            <Group justify="flex-end" mt="sm">
              <Button
                variant="default"
                onClick={() => setCategoryModalOpen(false)}
              >
                {t("cancel")}
              </Button>
              <Button type="submit" loading={categorySaving}>
                {t("save")}
              </Button>
            </Group>
          </Stack>
        </form>
      </Modal>

      <Modal
        opened={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingItem ? t("plannedExpenseEdit") : t("plannedExpenseAdd")}
      >
        <form onSubmit={submitForm}>
          <Stack gap="sm">
            {isWishlist && (
              <>
                <TextInput
                  label={t("plannedExpenseUrl")}
                  value={form.values.url}
                  onChange={handleUrlChange}
                />
                <Box mih={36}>
                  {isUrlSupported && (
                    <Group justify="space-between" gap="xs" wrap="nowrap">
                      <Text size="xs" c="dimmed" style={{ minWidth: 0 }}>
                        {t("productMetadataAutoFetchPrompt")}
                      </Text>
                      <Button
                        variant="light"
                        size="xs"
                        leftSection={<IconRefresh size={14} />}
                        onClick={() => void lookupMetadata()}
                        loading={metadataLoading}
                      >
                        {t("productMetadataLookup")}
                      </Button>
                    </Group>
                  )}
                </Box>
                {metadataPreview && (
                  <Paper withBorder p="sm" radius="md">
                    <Group align="flex-start" gap="sm" wrap="nowrap">
                      {metadataPreview.og_image_url && (
                        <Image
                          src={metadataPreview.og_image_url}
                          alt=""
                          w={64}
                          h={64}
                          radius="sm"
                          fit="cover"
                        />
                      )}
                      <Box style={{ minWidth: 0, flex: 1 }}>
                        <Group gap="xs" mb={4}>
                          <Badge size="xs" variant="light">
                            {t(`productSource_${metadataPreview.source_site}`)}
                          </Badge>
                          <Badge
                            size="xs"
                            color={availabilityColor(
                              metadataPreview.availability_status,
                            )}
                            variant="light"
                          >
                            {t(
                              `productAvailability_${metadataPreview.availability_status}`,
                            )}
                          </Badge>
                        </Group>
                        <Text size="sm" fw={700} lineClamp={2}>
                          {metadataPreview.name ??
                            metadataPreview.og_title ??
                            t("productMetadataNoName")}
                        </Text>
                        {metadataPreview.price_amount != null && (
                          <>
                            <Text size="sm" fw={800}>
                              {formatCurrency(
                                metadataPreview.price_amount,
                                locale,
                                metadataPreview.currency,
                              )}
                            </Text>
                            <ReferenceAmount
                              amount={metadataPreview.price_amount}
                              sourceCurrency={metadataPreview.currency}
                              selectedCurrency={selectedCurrency}
                              convertCurrency={convertCurrency}
                              locale={locale}
                              t={t}
                            />
                          </>
                        )}
                        {metadataPreview.error_message && (
                          <Text size="xs" c="dimmed" lineClamp={2}>
                            {metadataPreview.error_message}
                          </Text>
                        )}
                        <Group gap="xs" mt={4}>
                          <Text size="xs" c="dimmed">
                            {t("productMetadataCacheUntil")}{" "}
                            {dayjs(metadataPreview.expires_at).format("M/D H:mm")}
                          </Text>
                          {metadataPreview.normalized_url && (
                            <Anchor
                              size="xs"
                              href={metadataPreview.normalized_url}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {t("productMetadataOpen")}
                            </Anchor>
                          )}
                        </Group>
                      </Box>
                    </Group>
                  </Paper>
                )}
              </>
            )}
            <Select
              label={t("currencyLabel")}
              data={currencyOptions}
              allowDeselect={false}
              disabled={isShoppingList && form.values.category_id != null}
              value={form.values.currency}
              onChange={(value) => {
                const nextCurrency = value ?? selectedCurrency;
                form.setFieldValue("currency", nextCurrency);
                const selectedCategory = categories.find(
                  (category) =>
                    String(category.id) === form.values.category_id,
                );
                if (
                  selectedCategory &&
                  selectedCategory.currency !== nextCurrency
                ) {
                  form.setFieldValue("category_id", null);
                }
              }}
            />
            <Select
              label={categoryLabel}
              data={categoryOptions}
              clearable
              searchable
              {...form.getInputProps("category_id")}
            />
            <TextInput
              label={t("plannedExpenseName")}
              {...form.getInputProps("name")}
            />
            {isShoppingList &&
              categories.find(
                (category) => String(category.id) === form.values.category_id,
              )?.shopping_plan_type === "routine" && (
              <Checkbox
                label={t("shoppingPlanKeepItemOnClear")}
                {...form.getInputProps("keep_on_routine_clear", {
                  type: "checkbox",
                })}
              />
            )}
            {!isShoppingList && (
              <Group align="flex-end" grow>
                <NumberInput
                  label={
                    isWishlist
                      ? t("plannedExpenseItemEstimate")
                      : t("plannedExpenseBudgetAmount")
                  }
                  min={0}
                  decimalScale={currencyDecimalPlaces}
                  {...form.getInputProps("estimated_amount")}
                />
              </Group>
            )}
            {!isShoppingList && (
              <>
                <Select
                  label={t("plannedExpenseExpenseAccount")}
                  data={expenseAccountOptions}
                  clearable
                  searchable
                  renderOption={renderAccountOption as never}
                  {...form.getInputProps("expense_account_id")}
                />
                {budgetDistributionPreview.length > 0 && (
                  <Paper withBorder p="sm" radius="md">
                    <Stack gap="xs">
                      <Text size="sm" fw={600}>
                        {t("budgetDistributionPreview")}
                      </Text>
                      {budgetDistributionPreview.map((row) => (
                        <Group key={row.key} justify="space-between" gap="sm">
                          <Text
                            size="sm"
                            c={row.isUnallocated ? "dimmed" : undefined}
                            style={{ minWidth: 0, flex: 1 }}
                            lineClamp={1}
                          >
                            {row.name}
                          </Text>
                          <Group gap="xs" wrap="nowrap">
                            <Badge
                              size="sm"
                              color={row.isUnallocated ? "gray" : "blue"}
                              variant="light"
                            >
                              {row.ratio}%
                            </Badge>
                            <Text size="sm" fw={700} w={110} ta="right">
                              {formatCurrency(
                                row.amount,
                                locale,
                                form.values.currency,
                              )}
                            </Text>
                          </Group>
                        </Group>
                      ))}
                    </Stack>
                  </Paper>
                )}
              </>
            )}
            {isScheduled ? (
              <>
                <Select
                  label={t("plannedExpenseRecurrenceType")}
                  data={[
                    { value: "one_time", label: t("plannedExpenseOneTime") },
                    { value: "recurring", label: t("plannedExpenseRecurring") },
                  ]}
                  {...form.getInputProps("recurrence_type")}
                />
                {form.values.recurrence_type === "recurring" ? (
                  <>
                    <DatePickerInput
                      label={t("plannedExpenseNextDueDate")}
                      clearable
                      valueFormat={locale === "ja" ? "YYYY/M/D" : "MMM D, YYYY"}
                      {...form.getInputProps("next_due_date")}
                    />
                    <Group grow align="flex-start">
                      <NumberInput
                        label={t("plannedExpenseEveryInterval")}
                        min={1}
                        allowDecimal={false}
                        {...form.getInputProps("recurrence_interval")}
                      />
                      <Select
                        label={t("plannedExpenseRecurrenceUnit")}
                        data={recurrenceUnitOptions}
                        allowDeselect={false}
                        {...form.getInputProps("recurrence_unit")}
                      />
                    </Group>
                    {form.values.recurrence_unit === "month" && (
                      <>
                        <Select
                          label={t("plannedExpenseMonthlyMode")}
                          data={recurrenceMonthlyModeOptions}
                          allowDeselect={false}
                          {...form.getInputProps("recurrence_monthly_mode")}
                        />
                        {form.values.recurrence_monthly_mode ===
                        "day_of_month" ? (
                          <Select
                            label={t("plannedExpenseDayOfMonth")}
                            data={recurrenceDayOfMonthOptions}
                            {...form.getInputProps("recurrence_day")}
                          />
                        ) : (
                          <Stack gap="sm">
                            <Group grow align="flex-start">
                              <MultiSelect
                                label={t("plannedExpenseWeeksOfMonth")}
                                data={recurrenceWeekOfMonthOptions}
                                searchable={false}
                                {...form.getInputProps(
                                  "recurrence_weeks_of_month",
                                )}
                              />
                              <Select
                                label={t("plannedExpenseWeekday")}
                                data={recurrenceWeekdayOptions}
                                {...form.getInputProps("recurrence_weekday")}
                              />
                            </Group>
                            <Select
                              label={t("plannedExpenseWeekFallback")}
                              data={recurrenceWeekFallbackOptions}
                              allowDeselect={false}
                              {...form.getInputProps(
                                "recurrence_week_fallback",
                              )}
                            />
                          </Stack>
                        )}
                      </>
                    )}
                    <Select
                      label={t("plannedExpenseEndCondition")}
                      data={recurrenceEndModeOptions}
                      allowDeselect={false}
                      {...form.getInputProps("recurrence_end_mode")}
                    />
                    {form.values.recurrence_end_mode === "date" ? (
                      <Stack gap={4}>
                        <DatePickerInput
                          label={t("plannedExpenseEndDate")}
                          clearable
                          placeholder={t("plannedExpenseUnspecifiedPlaceholder")}
                          valueFormat={locale === "ja" ? "YYYY/M/D" : "MMM D, YYYY"}
                          {...form.getInputProps("end_date")}
                        />
                        {recurrencePlannedCountPreview != null && (
                          <Text size="xs" c="dimmed">
                            {t("plannedExpensePlannedCountHint").replace(
                              "{count}",
                              String(recurrencePlannedCountPreview),
                            )}
                          </Text>
                        )}
                        {recurrencePlannedCountDiffHint && (
                          <Text size="xs" c="orange">
                            {recurrencePlannedCountDiffHint}
                          </Text>
                        )}
                      </Stack>
                    ) : (
                      <Stack gap={4}>
                        <NumberInput
                          label={t("plannedExpenseFinalOccurrence")}
                          min={1}
                          allowDecimal={false}
                          placeholder={t("plannedExpenseUnspecifiedPlaceholder")}
                          {...form.getInputProps("recurrence_count")}
                        />
                        {recurrenceFinalDatePreview && (
                          <Text size="xs" c="dimmed">
                            {t("plannedExpenseFinalDateHint").replace(
                              "{date}",
                              dayjs(recurrenceFinalDatePreview).format(
                                locale === "ja" ? "YYYY/M/D" : "MMM D, YYYY",
                              ),
                            )}
                          </Text>
                        )}
                        {recurrencePlannedCountDiffHint && (
                          <Text size="xs" c="orange">
                            {recurrencePlannedCountDiffHint}
                          </Text>
                        )}
                      </Stack>
                    )}
                  </>
                ) : (
                  <DatePickerInput
                    label={t("plannedExpenseDueDate")}
                    clearable
                    valueFormat={locale === "ja" ? "YYYY/M/D" : "MMM D, YYYY"}
                    {...form.getInputProps("target_date")}
                  />
                )}
              </>
            ) : isWishlist ? (
              <DatePickerInput
                label={t("plannedExpenseTargetDate")}
                clearable
                valueFormat={locale === "ja" ? "YYYY/M/D" : "MMM D, YYYY"}
                {...form.getInputProps("target_date")}
              />
            ) : null}
            {showItemStatusField && (
              <Group grow>
                <Select
                  label={t("statusLabel")}
                  data={[
                    { value: "open", label: t("plannedExpenseStatus_open") },
                    {
                      value: "completed",
                      label: t("plannedExpenseStatus_completed"),
                    },
                    {
                      value: "cancelled",
                      label: t("plannedExpenseStatus_cancelled"),
                    },
                  ]}
                  {...form.getInputProps("status")}
                />
              </Group>
            )}
            <Textarea
              label={t("budgetAdjustNoteLabel")}
              minRows={3}
              {...form.getInputProps("note")}
            />
            <Group justify="flex-end" mt="sm">
              <Button variant="default" onClick={() => setModalOpen(false)}>
                {t("cancel")}
              </Button>
              <Button type="submit" loading={saving}>
                {t("save")}
              </Button>
            </Group>
          </Stack>
        </form>
      </Modal>
      <ConfirmModal
        opened={pendingExpenseInput != null}
        onClose={() => setPendingExpenseInput(null)}
        onConfirm={() => {
          if (pendingExpenseInput) {
            navigateToExpenseInput(pendingExpenseInput);
          }
        }}
        title={t("plannedExpenseCurrencyInputConfirmTitle")}
        message={t("plannedExpenseCurrencyInputConfirmMessage")
          .replace("{from}", pendingExpenseInput?.currency ?? "")
          .replace(
            "{to}",
            pendingExpenseInput?.inputCurrency ?? selectedCurrency,
          )}
        confirmColor="blue"
      />
      <ConfirmModal
        opened={deleteCategoryTarget != null}
        onClose={() => setDeleteCategoryTarget(null)}
        onConfirm={() => {
          if (deleteCategoryTarget) {
            void deleteCategory(deleteCategoryTarget);
          }
        }}
        title={
          deleteCategoryTarget?.kind === "shopping_list"
            ? t("shoppingPlanDeleteConfirmTitle")
            : t("plannedExpenseDeleteCategoryConfirmTitle")
        }
        message={
          deleteCategoryTarget?.kind === "shopping_list"
            ? t("shoppingPlanDeleteConfirmMessage")
            : t("plannedExpenseDeleteCategoryConfirmMessage")
        }
        confirmLabel={
          deleteCategoryTarget?.kind === "shopping_list"
            ? t("shoppingPlanDelete")
            : t("plannedExpenseDeleteCategoryConfirm")
        }
        confirmColor="red"
      />
      <ConfirmModal
        opened={deleteItemTarget != null}
        onClose={() => setDeleteItemTarget(null)}
        onConfirm={() => {
          if (deleteItemTarget) {
            void deleteItem(deleteItemTarget);
          }
        }}
        title={t("plannedExpenseDeleteItemConfirmTitle")}
        message={t("plannedExpenseDeleteItemConfirmMessage")}
        confirmLabel={t("plannedExpenseDeleteItemConfirm")}
        confirmColor="red"
      />
      <ConfirmModal
        opened={completeItemTarget != null}
        onClose={() => setCompleteItemTarget(null)}
        onConfirm={() => {
          if (completeItemTarget) {
            void updateStatus(completeItemTarget, "completed");
          }
        }}
        title={t("plannedExpenseForceCompleteConfirmTitle")}
        message={t("plannedExpenseForceCompleteConfirmMessage")}
        confirmLabel={t("plannedExpenseForceCompleteConfirm")}
        confirmColor="orange"
      />
      <ConfirmModal
        opened={restoreShoppingPlanTarget != null}
        onClose={() => setRestoreShoppingPlanTarget(null)}
        onConfirm={() => {
          if (restoreShoppingPlanTarget) {
            void restoreArchivedShoppingPlan(restoreShoppingPlanTarget);
          }
        }}
        title={t("shoppingPlanRestoreConfirmTitle")}
        message={t("shoppingPlanRestoreConfirmMessage")}
        confirmLabel={t("shoppingPlanRestore")}
        confirmColor="blue"
      />
    </Stack>
  );
}
