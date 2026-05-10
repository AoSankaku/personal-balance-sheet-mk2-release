import {
  ActionIcon,
  Anchor,
  Badge,
  Button,
  Divider,
  Group,
  Paper,
  ScrollArea,
  Select,
  Stack,
  Switch,
  Table,
  Text,
  Title,
  Tooltip,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  IconArrowDown,
  IconArrowUp,
  IconArchive,
  IconArchiveOff,
  IconEdit,
  IconTrash,
  IconWallet,
  IconPigMoney,
} from "@tabler/icons-react";
import type { BudgetCategory, BudgetFilter } from "@balance-sheet/shared";
import { api } from "../api/client";
import { useAppData } from "../context/AppDataContext";
import { BudgetCategoryModal } from "../components/BudgetCategoryModal";
import { BudgetFilterModal } from "../components/BudgetFilterModal";
import { ConfirmModal } from "../components/ConfirmModal";
import { BudgetPlacementTable } from "../components/BudgetPlacementTable";
import { useLang } from "../i18n";
import { formatCurrency } from "../lib/numberFormat";
import { showFeedback } from "../lib/feedback";

export default function BudgetSettingsPage() {
  const { t, locale } = useLang();
  const {
    budgetFilters,
    budgetCategories,
    budgetSummary,
    accounts,
    budgetSettings,
    currentYearMonth,
    refreshBudget,
    refreshBudgetFilters,
    refreshBudgetSettings,
    allocatableToday,
    allocatableTotal,
    assetBalanceToday,
    assetBalanceTotal,
    loggedToday,
    loggedTotal,
    displayCurrency,
  } = useAppData();
  const [modalOpened, { open: openModal, close: closeModal }] =
    useDisclosure(false);
  const [editingFilter, setEditingFilter] = useState<BudgetFilter | undefined>(
    undefined,
  );
  const [
    categoryModalOpened,
    { open: openCategoryModal, close: closeCategoryModal },
  ] = useDisclosure(false);
  const [editingCategory, setEditingCategory] = useState<
    BudgetCategory | undefined
  >(undefined);
  const [
    deleteConfirmOpened,
    { open: openDeleteConfirm, close: closeDeleteConfirm },
  ] = useDisclosure(false);
  const [filterToDelete, setFilterToDelete] = useState<BudgetFilter | null>(
    null,
  );
  const [showArchivedCategories, setShowArchivedCategories] = useState(false);
  const [archivedBudgetCategories, setArchivedBudgetCategories] = useState<
    BudgetCategory[]
  >([]);
  const selectedCurrency = displayCurrency || "JPY";

  useEffect(() => {
    if (!showArchivedCategories) {
      setArchivedBudgetCategories([]);
      return;
    }

    let cancelled = false;
    api.budget
      .listCategories({ includeArchived: true })
      .then((categories) => {
        if (!cancelled) {
          setArchivedBudgetCategories(
            categories.filter((category) => category.is_archived),
          );
        }
      })
      .catch(() => {
        if (!cancelled) setArchivedBudgetCategories([]);
      });

    return () => {
      cancelled = true;
    };
  }, [showArchivedCategories, budgetCategories]);

  async function handleDeleteBudgetCategory(id: number) {
    await api.budget.deleteCategory(id);
    showFeedback({ message: t("deleteBudgetCategory"), color: "orange" });
    void refreshBudget();
  }

  async function handleArchiveBudgetCategory(id: number, isArchived: boolean) {
    await api.budget.updateCategory(id, { is_archived: isArchived });
    showFeedback({
      message: isArchived
        ? t("archiveBudgetCategory")
        : t("restoreBudgetCategory"),
      color: isArchived ? "orange" : "teal",
    });
    void refreshBudget();
  }

  async function handleMoveBudgetCategory(
    index: number,
    direction: "up" | "down",
  ) {
    const cats = [...budgetCategories];
    const swapWith = direction === "up" ? index - 1 : index + 1;
    if (swapWith < 0 || swapWith >= cats.length) return;
    // Swap positions in array
    [cats[index], cats[swapWith]] = [cats[swapWith]!, cats[index]!];
    // Re-assign sort_orders by index to ensure uniqueness
    await Promise.all(
      cats.map((cat, i) =>
        cat.sort_order !== i
          ? api.budget.updateCategory(cat.id, { sort_order: i })
          : Promise.resolve(cat),
      ),
    );
    void refreshBudget();
  }

  function handleEditBudgetCategory(cat: BudgetCategory) {
    setEditingCategory(cat);
    openCategoryModal();
  }

  function handleOpenNewBudgetCategory() {
    setEditingCategory(undefined);
    openCategoryModal();
  }

  function handleCreate() {
    setEditingFilter(undefined);
    openModal();
  }

  function handleView(filter: BudgetFilter) {
    setEditingFilter(filter);
    openModal();
  }

  async function handleToggleActive(filter: BudgetFilter) {
    try {
      await api.budget.updateFilter(filter.id, {
        is_active: !filter.is_active,
      });
      void refreshBudgetFilters();
    } catch {
      showFeedback({ message: t("updateFailed"), color: "red" });
    }
  }

  function handleDelete(filter: BudgetFilter) {
    setFilterToDelete(filter);
    openDeleteConfirm();
  }

  async function savePreferredFilterIds(ids: number[]) {
    await api.budget.updateSettings({ preferred_filter_ids: ids });
    void refreshBudgetSettings();
  }

  async function handlePreferredFilterChange(
    index: number,
    value: string | null,
  ) {
    const current = budgetSettings?.preferred_filter_ids ?? [];
    const updated = [...current];
    if (value) {
      updated[index] = Number(value);
    } else {
      updated.splice(index, 1);
    }
    const deduped = updated.filter(
      (id, i) => id != null && updated.indexOf(id) === i,
    );
    await savePreferredFilterIds(deduped);
  }

  async function handleMovePreferredFilter(
    index: number,
    direction: "up" | "down",
  ) {
    const current = budgetSettings?.preferred_filter_ids ?? [];
    const updated = [...current];
    const swapWith = direction === "up" ? index - 1 : index + 1;
    if (swapWith < 0 || swapWith >= updated.length) return;
    [updated[index], updated[swapWith]] = [updated[swapWith]!, updated[index]!];
    await savePreferredFilterIds(updated);
  }

  async function confirmDelete() {
    if (!filterToDelete) return;
    try {
      await api.budget.deleteFilter(filterToDelete.id);
      showFeedback({ message: t("deleted"), color: "orange" });
      void refreshBudgetFilters();
    } catch (e) {
      const msg = e instanceof Error ? e.message : t("deleteFailed");
      showFeedback({ message: msg, color: "red" });
    }
  }

  return (
    <Stack gap="lg">
      <Group gap="xs">
        <Anchor component={Link} to="/settings" size="sm">
          {t("backToSettings")}
        </Anchor>
      </Group>

      <Paper withBorder px="md" py="sm" radius="md">
        <Stack gap={4}>
          <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
            {t("assignableMoneyLabel")}
          </Text>
          {[
            {
              label: t("assignableMoneyTodayLabel"),
              value: allocatableToday,
              assets: assetBalanceToday,
              committed: loggedToday,
            },
            {
              label: t("assignableMoneyTotalLabel"),
              value: allocatableTotal,
              assets: assetBalanceTotal,
              committed: loggedTotal,
            },
          ].map(({ label, value, assets, committed }) => {
            const fmt = (n: number) => formatCurrency(n, locale, selectedCurrency);
            return (
              <Group key={label} gap={6} align="baseline">
                <Text size="xs" c="dimmed" w={90}>
                  {label}
                </Text>
                <Text size="sm" fw={700} c={value >= 0 ? "teal" : "red"} w={90}>
                  {fmt(value)}
                </Text>
                <Text size="xs" c="dimmed">
                  = {fmt(assets)} ({t("assignableMoneyAssetsLabel")}) −{" "}
                  {fmt(committed)} ({t("assignableMoneyCommittedLabel")})
                </Text>
              </Group>
            );
          })}
        </Stack>
      </Paper>

      <Divider />

      <BudgetPlacementTable
        accounts={accounts}
        categorySummaries={budgetSummary?.categories ?? []}
        currency={selectedCurrency}
      />

      <Divider />

      {/* Budget categories */}
      <Stack gap="md">
        <Group justify="space-between">
          <Title order={4}>{t("budgetTitle")}</Title>
          <Group gap="sm">
            <Switch
              size="sm"
              label={t("showArchivedBudgetCategories")}
              checked={showArchivedCategories}
              onChange={(event) =>
                setShowArchivedCategories(event.currentTarget.checked)
              }
            />
            <Button variant="default" onClick={handleOpenNewBudgetCategory}>
              {t("addBudgetCategory")}
            </Button>
          </Group>
        </Group>
        {budgetCategories.length === 0 ? (
          <Text c="dimmed" size="sm">
            {t("noBudgetCategories")}
          </Text>
        ) : (
          <ScrollArea>
            <Table withTableBorder withColumnBorders style={{ minWidth: 400 }}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{t("budgetCategoryName")}</Table.Th>
                  <Table.Th>{t("budgetGroupLabel")}</Table.Th>
                  <Table.Th className="currency-cell">
                    {t("budgetBalanceCapLabel")}
                  </Table.Th>
                  <Table.Th className="currency-cell">
                    {t("goalBalanceLabel")}
                  </Table.Th>
                  <Table.Th style={{ width: 100 }} />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {budgetCategories.map((cat, i) => (
                  <Table.Tr key={cat.id}>
                    <Table.Td className="currency-cell">
                      <Group gap={6}>
                        {cat.budget_group === "貯蓄" ? (
                          <IconPigMoney
                            size={14}
                            color="var(--mantine-color-dimmed)"
                          />
                        ) : (
                          <IconWallet
                            size={14}
                            color="var(--mantine-color-dimmed)"
                          />
                        )}
                        {cat.name}
                      </Group>
                    </Table.Td>
                    <Table.Td className="currency-cell">
                      <Text size="xs" c="dimmed">
                        {cat.budget_group}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs" c="dimmed">
                        {cat.balance_cap != null
                          ? formatCurrency(
                              cat.balance_cap,
                              locale,
                              selectedCurrency,
                            )
                          : "—"}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      {cat.goal_balance != null ? (
                        <Text size="xs" c="dimmed">
                          {formatCurrency(
                            cat.goal_balance,
                            locale,
                            selectedCurrency,
                          )}
                        </Text>
                      ) : (
                        <Text size="xs" c="dimmed">
                          —
                        </Text>
                      )}
                    </Table.Td>
                    <Table.Td>
                      <Group gap={4} wrap="nowrap">
                        <ActionIcon
                          variant="subtle"
                          size="sm"
                          disabled={i === 0}
                          onClick={() => void handleMoveBudgetCategory(i, "up")}
                        >
                          <IconArrowUp size={14} />
                        </ActionIcon>
                        <ActionIcon
                          variant="subtle"
                          size="sm"
                          disabled={i === budgetCategories.length - 1}
                          onClick={() =>
                            void handleMoveBudgetCategory(i, "down")
                          }
                        >
                          <IconArrowDown size={14} />
                        </ActionIcon>
                        <Tooltip label={t("editBudgetCategory")}>
                          <ActionIcon
                            variant="subtle"
                            size="sm"
                            onClick={() => handleEditBudgetCategory(cat)}
                          >
                            <IconEdit size={14} />
                          </ActionIcon>
                        </Tooltip>
                        <Tooltip label={t("archiveBudgetCategory")}>
                          <ActionIcon
                            variant="subtle"
                            color="orange"
                            size="sm"
                            onClick={() =>
                              void handleArchiveBudgetCategory(cat.id, true)
                            }
                          >
                            <IconArchive size={14} />
                          </ActionIcon>
                        </Tooltip>
                        <Tooltip label={t("deleteBudgetCategory")}>
                          <ActionIcon
                            variant="subtle"
                            color="red"
                            size="sm"
                            onClick={() =>
                              void handleDeleteBudgetCategory(cat.id)
                            }
                          >
                            <IconTrash size={14} />
                          </ActionIcon>
                        </Tooltip>
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea>
        )}
        {showArchivedCategories && archivedBudgetCategories.length > 0 && (
          <ScrollArea>
            <Table withTableBorder withColumnBorders style={{ minWidth: 400 }}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{t("budgetCategoryName")}</Table.Th>
                  <Table.Th>{t("budgetGroupLabel")}</Table.Th>
                  <Table.Th style={{ width: 100 }} />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {archivedBudgetCategories.map((cat) => (
                  <Table.Tr key={cat.id}>
                    <Table.Td>
                      <Group gap={6}>
                        <Badge size="xs" variant="light" color="gray">
                          {t("archivedBudgetCategoryBadge")}
                        </Badge>
                        {cat.name}
                      </Group>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs" c="dimmed">
                        {cat.budget_group}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Tooltip label={t("restoreBudgetCategory")}>
                        <ActionIcon
                          variant="subtle"
                          color="teal"
                          size="sm"
                          onClick={() =>
                            void handleArchiveBudgetCategory(cat.id, false)
                          }
                        >
                          <IconArchiveOff size={14} />
                        </ActionIcon>
                      </Tooltip>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea>
        )}
      </Stack>

      <Divider />

      {/* Preferred filters */}
      <Stack gap="xs">
        <Title order={4}>{t("preferredFilterTitle")}</Title>
        <Text size="sm" c="dimmed">
          {t("preferredFilterHint")}
        </Text>
        {(() => {
          const ids = budgetSettings?.preferred_filter_ids ?? [];
          const slots = [
            ...ids,
            ...(ids.length < 5 ? [null as number | null] : []),
          ];
          const filterOptions = budgetFilters
            .filter((f) => f.is_active && f.currency === selectedCurrency)
            .map((f) => ({ value: String(f.id), label: f.name }));
          return (
            <Stack gap={6}>
              {slots.map((id, i) => (
                <Group key={i} gap="xs" align="center">
                  <Text size="xs" c="dimmed" w={16} ta="right">
                    {i + 1}.
                  </Text>
                  <Select
                    size="sm"
                    w={240}
                    placeholder={t("preferredFilterNone")}
                    clearable
                    value={id != null ? String(id) : null}
                    onChange={(v) => void handlePreferredFilterChange(i, v)}
                    data={filterOptions}
                  />
                  {id != null && (
                    <Group gap={2}>
                      <ActionIcon
                        variant="subtle"
                        size="sm"
                        disabled={i === 0}
                        onClick={() => void handleMovePreferredFilter(i, "up")}
                      >
                        <IconArrowUp size={14} />
                      </ActionIcon>
                      <ActionIcon
                        variant="subtle"
                        size="sm"
                        disabled={i >= ids.length - 1}
                        onClick={() =>
                          void handleMovePreferredFilter(i, "down")
                        }
                      >
                        <IconArrowDown size={14} />
                      </ActionIcon>
                    </Group>
                  )}
                </Group>
              ))}
            </Stack>
          );
        })()}
      </Stack>

      <Divider />

      <Group justify="space-between">
        <Title order={4}>{t("budgetFilterTitle")}</Title>
        <Button variant="default" onClick={handleCreate}>
          {t("createFilterBtn")}
        </Button>
      </Group>

      {budgetFilters.length === 0 ? (
        <Text c="dimmed" size="sm">
          {t("noFilters")}
        </Text>
      ) : (
        <ScrollArea>
          <Table withTableBorder withColumnBorders style={{ minWidth: 560 }}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t("thName")}</Table.Th>
                <Table.Th>{t("thStatus")}</Table.Th>
                <Table.Th>{t("thActions")}</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {budgetFilters.map((filter) => (
                <Table.Tr key={filter.id}>
                  <Table.Td>
                    <Anchor
                      component="button"
                      size="sm"
                      onClick={() => handleView(filter)}
                    >
                      {filter.name}
                    </Anchor>
                  </Table.Td>
                  <Table.Td>
                    {filter.is_active ? (
                      <Badge color="teal" variant="light" size="sm">
                        {t("badgeActive")}
                      </Badge>
                    ) : (
                      <Badge color="orange" variant="light" size="sm">
                        {t("badgeInactive")}
                      </Badge>
                    )}
                  </Table.Td>
                  <Table.Td>
                    <Group gap={4} wrap="nowrap">
                      <Button
                        size="xs"
                        variant="subtle"
                        onClick={() => handleView(filter)}
                      >
                        {t("editLabel")}
                      </Button>
                      <Button
                        size="xs"
                        variant="subtle"
                        color={filter.is_active ? "orange" : "teal"}
                        onClick={() => void handleToggleActive(filter)}
                      >
                        {filter.is_active
                          ? t("deactivateFilter")
                          : t("activateFilter")}
                      </Button>
                      <Button
                        size="xs"
                        variant="subtle"
                        color="red"
                        onClick={() => void handleDelete(filter)}
                      >
                        {t("deleteBudgetCategory")}
                      </Button>
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </ScrollArea>
      )}

      <BudgetFilterModal
        opened={modalOpened}
        onClose={closeModal}
        onSaved={() => void refreshBudgetFilters()}
        budgetCategories={budgetCategories}
        budgetFilters={budgetFilters}
        filter={editingFilter}
      />

      <BudgetCategoryModal
        opened={categoryModalOpened}
        onClose={closeCategoryModal}
        onSaved={() => void refreshBudget()}
        category={editingCategory}
        budgetCategories={budgetCategories}
        currentYearMonth={currentYearMonth}
      />

      <ConfirmModal
        opened={deleteConfirmOpened}
        onClose={closeDeleteConfirm}
        onConfirm={() => void confirmDelete()}
        title={t("deleteFilter")}
        message={t("filterDeleteConfirm")}
      />
    </Stack>
  );
}
