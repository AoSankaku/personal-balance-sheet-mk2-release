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
} from "@mantine/core";
import { DatePickerInput } from "@mantine/dates";
import { useForm } from "@mantine/form";
import {
  IconArrowLeft,
  IconCalendarDollar,
  IconCheck,
  IconChevronLeft,
  IconChevronRight,
  IconDotsVertical,
  IconEdit,
  IconGift,
  IconPlus,
  IconRefresh,
  IconReceipt,
  IconShoppingCart,
  IconStarFilled,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import dayjs from "dayjs";
import type { ChangeEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type {
  PlannedExpense,
  PlannedExpenseCategory,
  PlannedExpenseKind,
  PlannedExpenseRecurrenceType,
  PlannedExpenseStatus,
  ProductAvailabilityStatus,
  ProductMetadata,
  ShoppingPlanType,
} from "@balance-sheet/shared";
import { ApiError, api } from "../api/client";
import { useAppData } from "../context/AppDataContext";
import { useLang } from "../i18n";
import { formatCurrency } from "../lib/numberFormat";
import { accountDisplayName } from "../lib/accountUtils";
import {
  buildAccountOptions,
  renderAccountOption,
} from "../lib/accountSelect";
import type { PlannedExpenseEntrySource } from "../types/plannedExpenseInput";
import { ConfirmModal } from "../components/ConfirmModal";

type PlannedExpensePageProps = {
  kind: PlannedExpenseKind;
};

type PlannedExpenseFormValues = {
  category_id: string | null;
  name: string;
  estimated_amount: number | "";
  expense_account_id: string | null;
  target_date: Date | null;
  recurrence_type: PlannedExpenseRecurrenceType;
  recurrence_interval_months: number | "";
  recurrence_day: number | "";
  next_due_date: Date | null;
  end_date: Date | null;
  priority: string;
  status: PlannedExpenseStatus;
  keep_on_routine_clear: boolean;
  note: string;
  url: string;
  product_metadata_cache_id: number | null;
};

type CategoryFormValues = {
  name: string;
  estimated_amount: number | "";
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

type Translate = ReturnType<typeof useLang>["t"];

type ShoppingPlanGroup = {
  category: PlannedExpenseCategory | null;
  id: number | null;
  name: string;
  items: PlannedExpense[];
};

type UndatedShoppingPlanPosition = "first" | "last";

type BudgetDistributionPreviewRow = {
  key: string;
  name: string;
  amount: number;
  ratio: number;
  isUnallocated?: boolean;
};

const priorityColors: Record<number, string> = {
  1: "gray",
  2: "blue",
  3: "orange",
};
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

function statusColor(status: PlannedExpenseStatus) {
  if (status === "completed") return "teal";
  if (status === "cancelled") return "gray";
  return "blue";
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

function normalizeShoppingItemDuplicateText(value: string | null | undefined) {
  return value?.trim() ?? "";
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
      ? formatCurrency(category.estimated_amount, locale, selectedCurrency)
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
          disabled={isReferenceCurrency}
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
                disabled={isReferenceCurrency}
                onClick={() => onEditItem(item)}
              >
                {t("editLabel")}
              </Menu.Item>
              <Menu.Item
                color="red"
                leftSection={<IconTrash size={14} />}
                disabled={isReferenceCurrency}
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
  accountNameById,
  onRestorePlan,
  onRestoreItem,
}: {
  groups: ShoppingPlanGroup[];
  t: Translate;
  locale: string;
  selectedCurrency: string;
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
                      selectedCurrency,
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

export default function PlannedExpensePage({ kind }: PlannedExpensePageProps) {
  const { t, locale } = useLang();
  const { accounts, budgetCategories, displayCurrency, enabledCurrencies } =
    useAppData();
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
  const [restoreShoppingPlanTarget, setRestoreShoppingPlanTarget] =
    useState<ShoppingPlanGroup | null>(null);
  const [inlineShoppingItemDraft, setInlineShoppingItemDraft] =
    useState<InlineShoppingItemDraft | null>(null);
  const [
    undatedShoppingPlanPosition,
    setUndatedShoppingPlanPosition,
  ] = useState<UndatedShoppingPlanPosition>(readUndatedShoppingPlanPosition);
  const [calendarMonth, setCalendarMonth] = useState(() =>
    dayjs().startOf("month"),
  );

  const isShoppingList = kind === "shopping_list";
  const isWishlist = kind === "wishlist";
  const isScheduled = kind === "scheduled_payment";
  const selectedCurrency = displayCurrency || "JPY";
  const isDuplicateShoppingItem = ({
    categoryId,
    name,
    note,
    excludeId,
  }: {
    categoryId: number | null;
    name: string;
    note: string | null;
    excludeId?: number;
  }) => {
    if (!isShoppingList || categoryId == null) return false;
    const normalizedName = normalizeShoppingItemDuplicateText(name);
    const normalizedNote = normalizeShoppingItemDuplicateText(note);
    return [...items, ...archivedItems].some(
      (item) =>
        item.id !== excludeId &&
        item.category_id === categoryId &&
        normalizeShoppingItemDuplicateText(item.name) === normalizedName &&
        normalizeShoppingItemDuplicateText(item.note) === normalizedNote,
    );
  };
  const handlePlannedExpenseError = (error: unknown) => {
    if (
      error instanceof ApiError &&
      error.body.error === "duplicate_shopping_list_item"
    ) {
      return t("plannedExpenseDuplicateShoppingItem");
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

  const categoryOptions = categories.map((category) => ({
    value: String(category.id),
    label: category.name,
  }));

  const form = useForm<PlannedExpenseFormValues>({
    initialValues: {
      category_id: null,
      name: "",
      estimated_amount: "",
      expense_account_id: null,
      target_date: null,
      recurrence_type: "one_time",
      recurrence_interval_months: 1,
      recurrence_day: "",
      next_due_date: null,
      end_date: null,
      priority: "2",
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

  const categoryForm = useForm<CategoryFormValues>({
    initialValues: {
      name: "",
      estimated_amount: "",
      default_expense_account_id: null,
      target_date: null,
      shopping_plan_type: "one_time",
    },
    validate: {
      name: (value, values) =>
        value.trim() || (isShoppingList && values.target_date)
          ? null
          : categoryNameOrDateRequiredLabel,
      estimated_amount: (value) => {
        if (!isShoppingList || value === "") return null;
        return typeof value === "number" && value >= 0
          ? null
          : t("amountMustBePositive");
      },
    },
  });

  const isUrlSupported = isWishlist && isSupportedProductUrl(form.values.url);
  const currencyDecimalPlaces = useMemo(() => {
    const configured = enabledCurrencies.find(
      (currency) => currency.code === selectedCurrency,
    )?.decimal_places;
    if (configured != null) return configured;
    return selectedCurrency === "JPY" || selectedCurrency === "KRW" ? 0 : 2;
  }, [enabledCurrencies, selectedCurrency]);

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
    const showLoading = options.showLoading ?? false;
    if (showLoading) setLoading(true);
    try {
      const [
        nextItems,
        nextCategories,
        nextAllItems,
        nextAllCategories,
      ] = await Promise.all([
        api.plannedExpenses.list({ kind }),
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
      setItems(nextItems);
      setCategories(nextCategories);
      if (isShoppingList) {
        const archived = nextAllCategories
          .filter((category) => category.archived_at)
          .sort((a, b) =>
            (b.archived_at ?? "").localeCompare(a.archived_at ?? ""),
          );
        const archivedIds = new Set(archived.map((category) => category.id));
        setArchivedCategories(archived);
        setArchivedItems(
          nextAllItems.filter((item) =>
            item.category_id == null ? false : archivedIds.has(item.category_id),
          ),
        );
      } else {
        setArchivedCategories([]);
        setArchivedItems([]);
      }
    } finally {
      if (showLoading) setLoading(false);
    }
  };

  useEffect(() => {
    void loadData({ showLoading: true });
  }, [kind]);

  const resetItemForm = () => {
    form.setValues({
      category_id: null,
      name: "",
      estimated_amount: isShoppingList ? 0 : "",
      expense_account_id: null,
      target_date: null,
      recurrence_type: "one_time",
      recurrence_interval_months: 1,
      recurrence_day: "",
      next_due_date: null,
      end_date: null,
      priority: "2",
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
      form.setFieldValue(
        "category_id",
        categoryId == null ? null : String(categoryId),
      );
    }
    setModalOpen(true);
  };

  const openEditModal = (item: PlannedExpense) => {
    if (item.currency !== selectedCurrency) return;
    setEditingItem(item);
    form.setValues({
      category_id: item.category_id == null ? null : String(item.category_id),
      name: item.name,
      estimated_amount: isShoppingList ? 0 : item.estimated_amount,
      expense_account_id:
        item.expense_account_id == null ? null : String(item.expense_account_id),
      target_date: dateToInputDate(item.target_date),
      recurrence_type: item.recurrence_type,
      recurrence_interval_months: item.recurrence_interval_months ?? 1,
      recurrence_day: item.recurrence_day ?? "",
      next_due_date: dateToInputDate(item.next_due_date),
      end_date: dateToInputDate(item.end_date),
      priority: String(item.priority),
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
    const name = draft.name.trim();
    if (!name) {
      setInlineShoppingItemDraft({ ...draft, error: t("nameIsRequired") });
      return;
    }
    if (
      isDuplicateShoppingItem({
        categoryId: draft.categoryId,
        name,
        note: null,
      })
    ) {
      setInlineShoppingItemDraft({
        ...draft,
        error: t("plannedExpenseDuplicateShoppingItem"),
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
        currency: selectedCurrency,
        budget_category_id: null,
        expense_account_id: null,
        target_date: null,
        recurrence_type: "one_time",
        recurrence_interval_months: null,
        recurrence_day: null,
        next_due_date: null,
        end_date: null,
        priority: 2,
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
    if (metadata.price_amount != null && metadata.currency === selectedCurrency) {
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
        currency: selectedCurrency,
        default_expense_account_id:
          isShoppingList && values.default_expense_account_id != null
            ? Number(values.default_expense_account_id)
            : null,
        target_date: targetDate,
        shopping_plan_type: isShoppingList
          ? values.shopping_plan_type
          : "one_time",
      };
      if (editingCategory) {
        await api.plannedExpenses.updateCategory(editingCategory.id, payload);
      } else {
        await api.plannedExpenses.createCategory({ ...payload, kind });
      }
      setCategoryModalOpen(false);
      await loadData();
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
      const payload = {
        category_id:
          values.category_id == null ? null : Number(values.category_id),
        name: values.name.trim(),
        estimated_amount: amount,
        currency: selectedCurrency,
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
        recurrence_interval_months:
          isScheduled && recurrenceType === "recurring"
            ? Number(values.recurrence_interval_months || 1)
            : null,
        recurrence_day:
          isScheduled &&
          recurrenceType === "recurring" &&
          typeof values.recurrence_day === "number"
            ? values.recurrence_day
            : null,
        next_due_date:
          isScheduled && recurrenceType === "recurring"
            ? inputDateToString(values.next_due_date)
            : null,
        end_date:
          isScheduled && recurrenceType === "recurring"
            ? inputDateToString(values.end_date)
            : null,
        priority: isShoppingList ? 2 : Number(values.priority),
        status: values.status,
        keep_on_routine_clear: keepOnRoutineClear,
        note: values.note.trim() || null,
        url: isWishlist ? values.url.trim() || null : null,
        product_metadata_cache_id: isWishlist
          ? values.product_metadata_cache_id
          : null,
      };
      if (
        isDuplicateShoppingItem({
          categoryId: payload.category_id,
          name: payload.name,
          note: payload.note,
          excludeId: editingItem?.id,
        })
      ) {
        form.setFieldError("name", t("plannedExpenseDuplicateShoppingItem"));
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
        .filter((category) => category.id !== group.category?.id)
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

  const startExpenseInput = (item: PlannedExpense) => {
    const source: PlannedExpenseEntrySource = {
      id: item.id,
      kind: item.kind,
      name: item.name,
      amount: getInputAmount(item),
      currency: item.currency,
      expenseAccountId: item.expense_account_id,
      categoryId: item.category_id,
      categoryShoppingPlanType: item.category_shopping_plan_type ?? null,
    };
    navigate("/input", {
      state: {
        tab: "simple",
        plannedExpenseEntry: source,
      },
    });
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
    navigate("/input", {
      state: {
        tab: "simple",
        plannedExpenseEntry: source,
      },
    });
  };

  const activeCurrencyItems = items.filter(
    (item) => item.currency === selectedCurrency,
  );
  const referenceCurrencyItems = items.filter(
    (item) => item.currency !== selectedCurrency,
  );
  const sortedItems = useMemo(
    () => {
      if (isShoppingList) {
        return [...items].sort(compareShoppingItems);
      }
      return [...items].sort(
        (a, b) =>
          statusRank[a.status] - statusRank[b.status] ||
          (dueDateForItem(a) ?? "9999-12-31").localeCompare(
            dueDateForItem(b) ?? "9999-12-31",
          ) ||
          b.priority - a.priority ||
          b.id - a.id,
      );
    },
    [isShoppingList, items],
  );

  const sortedShoppingCategories = useMemo(() => {
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
  }, [categories, isShoppingList, undatedShoppingPlanPosition]);

  const groupedCategories = useMemo(() => {
    const groups: ShoppingPlanGroup[] = sortedShoppingCategories.map((category) => ({
      category,
      id: category.id,
      name: category.name,
      items: sortedItems.filter(
        (item) => item.category_id === category.id,
      ),
    }));
    const uncategorizedItems = sortedItems.filter(
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
  }, [noCategoryLabel, sortedItems, sortedShoppingCategories]);

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

  const openTotal = activeCurrencyItems.reduce((sum, item) => {
    if (item.status !== "open") return sum;
    if (isShoppingList) return sum;
    return sum + item.estimated_amount;
  }, 0);
  const calendarDays = useMemo(() => {
    const start = calendarMonth.startOf("month").startOf("week");
    return Array.from({ length: 42 }, (_, index) => start.add(index, "day"));
  }, [calendarMonth]);
  const calendarItemsByDate = useMemo(() => {
    const map = new Map<string, PlannedExpense[]>();
    for (const item of items) {
      if (item.status !== "open") continue;
      const date = dueDateForItem(item);
      if (!date) continue;
      const list = map.get(date) ?? [];
      list.push(item);
      map.set(date, list);
    }
    return map;
  }, [items]);

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
            <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
              {t("plannedMoneyTitle")}
            </Text>
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
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <Paper withBorder p="md" radius="md">
            <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
              {t("plannedExpenseOpenCount")}
            </Text>
            <Text fw={800} size="xl">
              {activeCurrencyItems.filter((item) => item.status === "open").length}
            </Text>
          </Paper>
          <Paper withBorder p="md" radius="md">
            <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
              {t("plannedExpenseOpenTotal")}
            </Text>
            <Text fw={800} size="xl">
              {formatCurrency(openTotal, locale, selectedCurrency)}
            </Text>
          </Paper>
        </SimpleGrid>
      )}

      {isScheduled && (
        <Paper withBorder p="md" radius="md">
          <Group justify="space-between" mb="sm">
            <Text fw={700} size="sm">
              {t("plannedExpenseCalendar")}
            </Text>
            <Group gap="xs">
              <ActionIcon
                variant="subtle"
                onClick={() => setCalendarMonth((month) => month.subtract(1, "month"))}
                aria-label="Previous month"
              >
                <IconChevronLeft size={16} />
              </ActionIcon>
              <Text fw={700} size="sm" w={92} ta="center">
                {calendarMonth.format("YYYY/MM")}
              </Text>
              <ActionIcon
                variant="subtle"
                onClick={() => setCalendarMonth((month) => month.add(1, "month"))}
                aria-label="Next month"
              >
                <IconChevronRight size={16} />
              </ActionIcon>
            </Group>
          </Group>
          <SimpleGrid cols={7} spacing={4}>
            {calendarDays.map((date) => {
              const dateKey = date.format("YYYY-MM-DD");
              const dayItems = calendarItemsByDate.get(dateKey) ?? [];
              const total = dayItems.reduce(
                (sum, item) =>
                  item.currency === selectedCurrency
                    ? sum + item.estimated_amount
                    : sum,
                0,
              );
              return (
                <Box
                  key={dateKey}
                  p={6}
                  mih={72}
                  style={{
                    border: "1px solid var(--mantine-color-default-border)",
                    borderRadius: 6,
                    opacity: date.month() === calendarMonth.month() ? 1 : 0.42,
                  }}
                >
                  <Text size="xs" c="dimmed" fw={700}>
                    {date.date()}
                  </Text>
                  {dayItems.length > 0 && (
                    <Stack gap={2} mt={3}>
                      <Text size="xs" fw={700} c="blue">
                        {formatCurrency(total, locale, selectedCurrency)}
                      </Text>
                      <Text size="xs" lineClamp={2}>
                        {dayItems.map((item) => item.name).join(", ")}
                      </Text>
                    </Stack>
                  )}
                </Box>
              );
            })}
          </SimpleGrid>
        </Paper>
      )}

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
            onDeletePlan={setDeleteCategoryTarget}
            onToggleItem={(item, checked) =>
              void updateStatus(item, checked ? "completed" : "open")
            }
            onEditItem={openEditModal}
            onDeleteItem={(item) => void deleteItem(item)}
          />
          <ArchivedShoppingPlanList
            groups={archivedGroupedCategories}
            t={t}
            locale={locale}
            selectedCurrency={selectedCurrency}
            accountNameById={accountNameById}
            onRestorePlan={setRestoreShoppingPlanTarget}
            onRestoreItem={(group, item) =>
              void restoreArchivedShoppingItem(group, item)
            }
          />
        </Stack>
      ) : (
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
                      item.currency === selectedCurrency
                        ? sum + item.estimated_amount
                        : sum,
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
              return (
                <Box key={group.id ?? "__none"}>
                  <Group
                    justify="space-between"
                    px="md"
                    py={isShoppingList ? "sm" : "xs"}
                    bg="var(--mantine-color-default-hover)"
                  >
                    <Group gap={isShoppingList ? "sm" : "xs"}>
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
                            onClick={() => void deleteCategory(group.category!)}
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
                    group.items.map((item) => {
                      const isReferenceCurrency = item.currency !== selectedCurrency;
                      return (
                        <Box
                          key={item.id}
                          px="md"
                          py="sm"
                          style={{
                            borderBottom:
                              "1px solid var(--mantine-color-default-border)",
                          }}
                        >
                          <Group justify="space-between" align="flex-start" gap="sm">
                            <Group gap="sm" align="flex-start" wrap="nowrap" style={{ minWidth: 0, flex: 1 }}>
                              {isShoppingList && (
                                <Checkbox
                                  mt={2}
                                  checked={item.status === "completed"}
                                  disabled={isReferenceCurrency}
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
                              <Box style={{ minWidth: 0, flex: 1 }}>
                                <Group gap="xs" mb={4}>
                                  <Text fw={700} size="sm" lineClamp={1}>
                                    {item.name}
                                  </Text>
                                  {!isShoppingList && (
                                    <Badge
                                      size="xs"
                                      color={statusColor(item.status)}
                                      variant="light"
                                    >
                                      {t(`plannedExpenseStatus_${item.status}`)}
                                    </Badge>
                                  )}
                                  {!isShoppingList && (
                                    <Badge
                                      size="xs"
                                      color={priorityColors[item.priority] ?? "gray"}
                                      variant="light"
                                    >
                                      {t("plannedExpensePriority")} {item.priority}
                                    </Badge>
                                  )}
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
                            <Stack gap={4} align="flex-end">
                              {!isShoppingList && (
                                <Text fw={800} size="sm">
                                  {formatCurrency(
                                    item.estimated_amount,
                                    locale,
                                    item.currency,
                                  )}
                                </Text>
                              )}
                              {item.product_metadata?.price_amount != null && (
                                <Text size="xs" c="dimmed">
                                  {t("productMetadataPrice")}{" "}
                                  {formatCurrency(
                                    item.product_metadata.price_amount,
                                    locale,
                                    item.product_metadata.currency,
                                  )}
                                </Text>
                              )}
                              <Group gap={4} wrap="nowrap">
                                {item.url && (
                                  <ActionIcon
                                    variant="subtle"
                                    color="blue"
                                    aria-label={t("productMetadataRefresh")}
                                    disabled={isReferenceCurrency}
                                    onClick={() => void refreshItemMetadata(item)}
                                  >
                                    <IconRefresh size={16} />
                                  </ActionIcon>
                                )}
                                {item.status === "open" && (
                                  <Tooltip
                                    label={t("plannedExpenseInputExpense")}
                                    withArrow
                                  >
                                    <ActionIcon
                                      variant="subtle"
                                      color={pageColor}
                                      aria-label={t("plannedExpenseInputExpense")}
                                      disabled={isReferenceCurrency}
                                      onClick={() => startExpenseInput(item)}
                                    >
                                      <IconReceipt size={16} />
                                    </ActionIcon>
                                  </Tooltip>
                                )}
                                {!isShoppingList && item.status !== "completed" && (
                                  <Tooltip
                                    label={t("plannedExpenseComplete")}
                                    withArrow
                                  >
                                    <ActionIcon
                                      variant="subtle"
                                      color="teal"
                                      aria-label={t("plannedExpenseComplete")}
                                      disabled={isReferenceCurrency}
                                      onClick={() =>
                                        void updateStatus(item, "completed")
                                      }
                                    >
                                      <IconCheck size={16} />
                                    </ActionIcon>
                                  </Tooltip>
                                )}
                                {!isShoppingList && item.status !== "cancelled" && (
                                  <Tooltip
                                    label={t("plannedExpenseCancel")}
                                    withArrow
                                  >
                                    <ActionIcon
                                      variant="subtle"
                                      color="gray"
                                      aria-label={t("plannedExpenseCancel")}
                                      disabled={isReferenceCurrency}
                                      onClick={() =>
                                        void updateStatus(item, "cancelled")
                                      }
                                    >
                                      <IconX size={16} />
                                    </ActionIcon>
                                  </Tooltip>
                                )}
                                <ActionIcon
                                  variant="subtle"
                                  aria-label={t("editLabel")}
                                  disabled={isReferenceCurrency}
                                  onClick={() => openEditModal(item)}
                                >
                                  <IconEdit size={16} />
                                </ActionIcon>
                                <Tooltip label={t("deleteBudgetCategory")} withArrow>
                                  <ActionIcon
                                    variant="subtle"
                                    color="red"
                                    aria-label={t("deleteBudgetCategory")}
                                    disabled={isReferenceCurrency}
                                    onClick={() => void deleteItem(item)}
                                  >
                                    <IconTrash size={16} />
                                  </ActionIcon>
                                </Tooltip>
                              </Group>
                            </Stack>
                          </Group>
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
            {isShoppingList && (
              <>
                <NumberInput
                  label={categoryEstimateLabel}
                  min={0}
                  decimalScale={4}
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
                          <Text size="sm" fw={800}>
                            {formatCurrency(
                              metadataPreview.price_amount,
                              locale,
                              metadataPreview.currency,
                            )}
                          </Text>
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
                  decimalScale={4}
                  {...form.getInputProps("estimated_amount")}
                />
                <Box>
                  <Text size="xs" c="dimmed" fw={500} mb={6}>
                    {t("currencyLabel")}
                  </Text>
                  <Badge size="lg" variant="light" h={36}>
                    {selectedCurrency}
                  </Badge>
                </Box>
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
                                selectedCurrency,
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
                        label={t("plannedExpenseEveryMonths")}
                        min={1}
                        allowDecimal={false}
                        {...form.getInputProps("recurrence_interval_months")}
                      />
                      <NumberInput
                        label={t("plannedExpenseDayOfMonth")}
                        min={1}
                        max={31}
                        allowDecimal={false}
                        {...form.getInputProps("recurrence_day")}
                      />
                    </Group>
                    <DatePickerInput
                      label={t("plannedExpenseEndDate")}
                      clearable
                      valueFormat={locale === "ja" ? "YYYY/M/D" : "MMM D, YYYY"}
                      {...form.getInputProps("end_date")}
                    />
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
            <Group grow>
              {!isShoppingList && (
                <Select
                  label={t("plannedExpensePriority")}
                  data={[
                    { value: "1", label: t("plannedExpensePriorityLow") },
                    { value: "2", label: t("plannedExpensePriorityMedium") },
                    { value: "3", label: t("plannedExpensePriorityHigh") },
                  ]}
                  {...form.getInputProps("priority")}
                />
              )}
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
        opened={deleteCategoryTarget != null}
        onClose={() => setDeleteCategoryTarget(null)}
        onConfirm={() => {
          if (deleteCategoryTarget) {
            void deleteCategory(deleteCategoryTarget);
          }
        }}
        title={t("shoppingPlanDeleteConfirmTitle")}
        message={t("shoppingPlanDeleteConfirmMessage")}
        confirmLabel={t("shoppingPlanDelete")}
        confirmColor="red"
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
