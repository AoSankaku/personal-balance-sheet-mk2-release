import {
  Button,
  Group,
  Modal,
  Select,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { useEffect, useState } from "react";
import type {
  Account,
  CryptoBalance,
  CryptoChain,
} from "@balance-sheet/shared";
import { api } from "../api/client";
import { useLang } from "../i18n";
import {
  categoryIndex,
  isUserSelectableAccount,
  toAccountSelectOption,
} from "../lib/accountUtils";
import { renderAccountOption } from "../lib/accountSelect";
import { cryptoChainsForCurrency } from "./tt/cryptoBalanceSync";

const CHAIN_OPTIONS = [
  { value: "eth", label: "Ethereum (ETH)" },
  { value: "btc", label: "Bitcoin (BTC)" },
  { value: "sol", label: "Solana (SOL)" },
  { value: "skr", label: "Seeker (SKR)" },
  { value: "msol", label: "Marinade staked SOL (mSOL)" },
  {
    value: "sol_stake",
    label: "Solana Native Stake account (ステークアカウントアドレスを入力)",
  },
];

interface Props {
  opened: boolean;
  onClose: () => void;
  onAdded: () => void;
  assetAccounts: Account[];
  linkedAccountIds: Set<number>;
  currency: string;
}

export function CryptoWatchModal({
  opened,
  onClose,
  onAdded,
  assetAccounts,
  linkedAccountIds,
  currency,
}: Props) {
  const { t } = useLang();
  const availableChains = cryptoChainsForCurrency(currency);
  const defaultChain = availableChains[0] ?? null;
  const chainOptions = CHAIN_OPTIONS.filter((option) =>
    availableChains.includes(option.value as CryptoChain),
  );

  const [address, setAddress] = useState("");
  const [chainSelect, setChainSelect] = useState<CryptoChain | null>(
    defaultChain,
  );
  const [accountId, setAccountId] = useState<string | null>(null);
  const [balance, setBalance] = useState<CryptoBalance | null>(null);
  const [fetching, setFetching] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setAddress("");
    setChainSelect(defaultChain);
    setAccountId(null);
    setBalance(null);
    setError(null);
  }, [currency, defaultChain]);

  const effectiveChain = chainSelect;

  const availableAccounts = assetAccounts
    .filter((a) => !linkedAccountIds.has(a.id) && isUserSelectableAccount(a))
    .slice()
    .sort(
      (a, b) =>
        categoryIndex(a.type, a.category, a.is_system ?? false) -
        categoryIndex(b.type, b.category, b.is_system ?? false),
    );

  async function handleFetchBalance() {
    if (!effectiveChain) return;
    setFetching(true);
    setError(null);
    setBalance(null);
    try {
      const bal = await api.crypto.balance(address.trim(), effectiveChain);
      setBalance(bal);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch balance");
    } finally {
      setFetching(false);
    }
  }

  async function handleSubmit() {
    if (!accountId || !effectiveChain) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.crypto.create({
        account_id: Number(accountId),
        address: address.trim(),
        chain: effectiveChain,
      });
      onAdded();
      handleClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add wallet");
    } finally {
      setSubmitting(false);
    }
  }

  function handleClose() {
    setAddress("");
    setChainSelect(defaultChain);
    setAccountId(null);
    setBalance(null);
    setError(null);
    onClose();
  }

  return (
    <Modal
      opened={opened}
      onClose={handleClose}
      title={t("addWallet")}
      centered
    >
      <Stack>
        <Select
          label="Chain"
          data={chainOptions}
          value={chainSelect}
          onChange={(v) => {
            setChainSelect((v as CryptoChain | null) ?? defaultChain);
            setBalance(null);
          }}
          allowDeselect={false}
          disabled={chainOptions.length <= 1}
        />

        <TextInput
          label={t("walletAddress")}
          placeholder="0x... or bc1... or 1..."
          value={address}
          onChange={(e) => {
            setAddress(e.currentTarget.value);
            setBalance(null);
          }}
        />

        <Group>
          <Button
            size="sm"
            variant="default"
            loading={fetching}
            disabled={!effectiveChain || !address.trim()}
            onClick={handleFetchBalance}
          >
            {t("fetchBalance")}
          </Button>
          {balance && (
            <Text size="sm" fw={500}>
              {balance.amount.toLocaleString("en-US", {
                maximumFractionDigits: 12,
              })} {currency.toUpperCase()}
            </Text>
          )}
        </Group>

        <Select
          label={t("linkAccount")}
          placeholder={t("selectAccount")}
          data={availableAccounts.map((a) => toAccountSelectOption(a, t))}
          renderOption={renderAccountOption as never}
          value={accountId}
          onChange={setAccountId}
        />

        {error && (
          <Text size="sm" c="red">
            {error}
          </Text>
        )}

        <Group justify="flex-end">
          <Button variant="default" onClick={handleClose}>
            {t("cancel")}
          </Button>
          <Button
            onClick={handleSubmit}
            loading={submitting}
            disabled={!effectiveChain || !address.trim() || !accountId}
          >
            {t("add")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
