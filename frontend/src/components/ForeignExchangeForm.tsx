import { useState } from "react";
import {
  Button,
  Group,
  NumberInput,
  Select,
  Stack,
  Text,
} from "@mantine/core";
import { DatePickerInput } from "@mantine/dates";
import { useAppData } from "../context/AppDataContext";
import { useLang } from "../i18n";
import { api } from "../api/client";
import {
  isUserSelectableAccount,
  toAccountSelectOption,
} from "../lib/accountUtils";
import { renderAccountOption } from "../lib/accountSelect";
import { toDateStr } from "../lib/dateUtils";

interface Props {
  onSuccess?: () => void;
}

export function ForeignExchangeForm({ onSuccess }: Props) {
  const { t, locale } = useLang();
  const { accounts, enabledCurrencies, convertCurrency } = useAppData();

  const today = new Date();
  const [date, setDate] = useState<Date | null>(today);
  const [fromCurrency, setFromCurrency] = useState<string | null>(
    enabledCurrencies[0]?.code ?? "JPY",
  );
  const [toCurrency, setToCurrency] = useState<string | null>(
    enabledCurrencies[1]?.code ?? "JPY",
  );
  const [fromAccountId, setFromAccountId] = useState<string | null>(null);
  const [toAccountId, setToAccountId] = useState<string | null>(null);
  const [fromAmount, setFromAmount] = useState<number | string>("");
  const [toAmount, setToAmount] = useState<number | string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currencyOptions = enabledCurrencies.map((c) => ({
    value: c.code,
    label: c.code,
  }));

  const assetLiabilityAccounts = accounts.filter(
    (a) =>
      (a.type === "asset" || a.type === "liability") &&
      isUserSelectableAccount(a),
  );
  const accountOptions = assetLiabilityAccounts.map((a) =>
    toAccountSelectOption(a, t),
  );

  // Auto-fill toAmount when fromAmount changes using exchange rates
  function handleFromAmountChange(val: number | string) {
    setFromAmount(val);
    if (
      typeof val === "number" &&
      val > 0 &&
      fromCurrency &&
      toCurrency &&
      fromCurrency !== toCurrency
    ) {
      const converted = convertCurrency(val, fromCurrency, toCurrency);
      setToAmount(Math.round(converted * 100) / 100);
    }
  }

  async function handleSubmit() {
    if (
      !date ||
      !fromCurrency ||
      !toCurrency ||
      !fromAccountId ||
      !toAccountId ||
      !fromAmount ||
      !toAmount
    ) {
      setError(
        locale === "ja" ? "すべての項目を入力してください" : "All fields are required",
      );
      return;
    }
    if (fromCurrency === toCurrency) {
      setError(
        locale === "ja"
          ? "通貨が同じです。異なる通貨を選択してください"
          : "Source and destination currencies must differ",
      );
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const dateStr = toDateStr(date);
      const description =
        locale === "ja"
          ? `外貨両替 ${fromCurrency}→${toCurrency}`
          : `FX Exchange ${fromCurrency}→${toCurrency}`;

      await api.journal.create({
        date: dateStr,
        description,
        is_currency_exchange: true,
        lines: [
          // Give: credit the source account in source currency
          {
            account_id: Number(fromAccountId),
            debit: 0,
            credit: Number(fromAmount),
            currency: fromCurrency,
          },
          // Receive: debit the destination account in destination currency
          {
            account_id: Number(toAccountId),
            debit: Number(toAmount),
            credit: 0,
            currency: toCurrency,
          },
        ],
      });

      // Reset form
      setFromAmount("");
      setToAmount("");
      setFromAccountId(null);
      setToAccountId(null);
      onSuccess?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Stack gap="sm">
      <DatePickerInput
        label={locale === "ja" ? "日付" : "Date"}
        value={date}
        onChange={setDate}
        valueFormat="YYYY-MM-DD"
        required
      />

      <Group align="flex-end" grow>
        <Select
          label={t("fxFromCurrency")}
          data={currencyOptions}
          value={fromCurrency}
          onChange={setFromCurrency}
          allowDeselect={false}
        />
        <Select
          label={t("fxToCurrency")}
          data={currencyOptions}
          value={toCurrency}
          onChange={setToCurrency}
          allowDeselect={false}
        />
      </Group>

      <Group align="flex-end" grow>
        <Select
          label={t("fxFromAccount")}
          data={accountOptions}
          renderOption={renderAccountOption as never}
          value={fromAccountId}
          onChange={setFromAccountId}
          searchable
          placeholder={locale === "ja" ? "科目を選択" : "Select account"}
        />
        <NumberInput
          label={`${t("fxFromAmount")} (${fromCurrency ?? ""})`}
          value={fromAmount}
          onChange={handleFromAmountChange}
          min={0}
          decimalScale={8}
          thousandSeparator=","
        />
      </Group>

      <Group align="flex-end" grow>
        <Select
          label={t("fxToAccount")}
          data={accountOptions}
          renderOption={renderAccountOption as never}
          value={toAccountId}
          onChange={setToAccountId}
          searchable
          placeholder={locale === "ja" ? "科目を選択" : "Select account"}
        />
        <NumberInput
          label={`${t("fxToAmount")} (${toCurrency ?? ""})`}
          value={toAmount}
          onChange={setToAmount}
          min={0}
          decimalScale={8}
          thousandSeparator=","
        />
      </Group>

      {error && (
        <Text size="sm" c="red">
          {error}
        </Text>
      )}

      <Button onClick={() => void handleSubmit()} loading={loading} fullWidth>
        {locale === "ja" ? "両替を記録" : "Record Exchange"}
      </Button>
    </Stack>
  );
}
