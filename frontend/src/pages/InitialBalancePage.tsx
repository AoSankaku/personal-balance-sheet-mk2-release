import {
  Anchor,
  Button,
  Group,
  NumberInput,
  Select,
  Skeleton,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { DateInput } from "@mantine/dates";
import { IconDatabaseImport } from "@tabler/icons-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import dayjs from "dayjs";
import { api } from "../api/client";
import { useLang } from "../i18n";
import { useAppData } from "../context/AppDataContext";
import {
  categoryIndex,
  isUserSelectableAccount,
  toAccountSelectOption,
} from "../lib/accountUtils";
import { renderAccountOption } from "../lib/accountSelect";
import { showFeedback } from "../lib/feedback";
import { AppDataErrorAlert } from "../components/AppDataErrorAlert";
import type { Account } from "@balance-sheet/shared";

export default function InitialBalancePage() {
  const { t } = useLang();
  const {
    accounts,
    loading,
    error,
    refresh,
    displayCurrency,
    displayCurrencySymbol,
  } = useAppData();

  const [initialAssetId, setInitialAssetId] = useState<string | null>(null);
  const [initialAmount, setInitialAmount] = useState<number | string>(0);
  const [initialDate, setInitialDate] = useState<Date>(new Date());

  function sortByCategory<
    T extends {
      type: Account["type"];
      category: Account["category"];
      is_system?: boolean;
      name: string;
    },
  >(list: T[]): T[] {
    return [...list].sort((a, b) => {
      const ai = categoryIndex(a.type, a.category, a.is_system ?? false);
      const bi = categoryIndex(b.type, b.category, b.is_system ?? false);
      if (ai !== bi) return ai - bi;
      return a.name.localeCompare(b.name, "ja");
    });
  }

  const assets = useMemo(
    () =>
      sortByCategory(
        accounts.filter(
          (a) => a.type === "asset" && isUserSelectableAccount(a),
        ),
      ),
    [accounts],
  );

  if (loading) {
    return (
      <Stack gap="lg">
        <Skeleton height={24} width={200} radius="sm" />
        <Skeleton height={40} radius="sm" />
        <Skeleton height={40} radius="sm" />
        <Skeleton height={40} radius="sm" />
      </Stack>
    );
  }

  if (error) {
    return <AppDataErrorAlert error={error} />;
  }

  return (
    <Stack gap="xl">
      <Group gap="xs">
        <Anchor component={Link} to="/settings" size="sm" c="dimmed">
          {t("settingsSubpageBack")}
        </Anchor>
      </Group>

      <Stack gap="sm">
        <Group gap="xs">
          <IconDatabaseImport size={22} />
          <Title order={3}>{t("tabInitialBalance")}</Title>
        </Group>
        <Text size="sm" c="dimmed">
          {t("initialBalanceHint")}
        </Text>
      </Stack>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void (async () => {
            if (!initialAssetId || Number(initialAmount) <= 0) return;
            const selectedAccount = accounts.find(
              (a) => a.id === Number(initialAssetId),
            );
            const equityAccount = accounts.find(
              (a) => a.type === "equity" && a.is_system === true,
            );
            if (!equityAccount) return;
            await api.journal.create({
              date: dayjs(initialDate).format("YYYY-MM-DD"),
              description: `${t("sysOpeningBalance")} - ${selectedAccount?.name ?? ""}`,
              lines: [
                {
                  account_id: Number(initialAssetId),
                  debit: Number(initialAmount),
                  credit: 0,
                  currency: displayCurrency,
                },
                {
                  account_id: equityAccount.id,
                  debit: 0,
                  credit: Number(initialAmount),
                  currency: displayCurrency,
                },
              ],
            });
            showFeedback({ message: t("transactionSaved"), color: "teal" });
            setInitialAssetId(null);
            setInitialAmount(0);
            setInitialDate(new Date());
            refresh();
          })();
        }}
      >
        <Stack gap="sm" maw={480}>
          <DateInput
            label={t("dateLabel")}
            required
            valueFormat="YYYY-MM-DD"
            value={initialDate}
            onChange={(v) => setInitialDate(v ?? new Date())}
          />
          <Select
            label={t("initialAssetAccountLabel")}
            placeholder={t("selectAccount")}
            data={assets.map((a) => toAccountSelectOption(a, t))}
            renderOption={renderAccountOption as never}
            searchable
            required
            value={initialAssetId}
            onChange={setInitialAssetId}
          />
          <NumberInput
            label={t("amountLabel")}
            placeholder="0"
            required
            min={1}
            prefix={displayCurrencySymbol}
            thousandSeparator=","
            value={initialAmount}
            onChange={setInitialAmount}
          />
          <Group justify="flex-end">
            <Button
              type="submit"
              disabled={!initialAssetId || Number(initialAmount) <= 0}
            >
              {t("add")}
            </Button>
          </Group>
        </Stack>
      </form>
    </Stack>
  );
}
