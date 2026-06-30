import {
  Badge,
  Button,
  Group,
  Modal,
  Paper,
  Select,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { useState } from "react";
import type {
  Account,
  CryptoBalance,
  CryptoChain,
} from "@balance-sheet/shared";
import { api } from "../api/client";
import { useLang } from "../i18n";
import { useAppData } from "../context/AppDataContext";
import {
  categoryIndex,
  isUserSelectableAccount,
  toAccountSelectOption,
} from "../lib/accountUtils";
import { renderAccountOption } from "../lib/accountSelect";
import { formatJPY } from "../lib/numberFormat";

/** Auto-detect chain from address format.
 *  ETH: 0x + 40 hex chars.
 *  BTC: starts with 1/3 (P2PKH/P2SH, 26–35 chars) or bc1 (bech32).
 *  SOL: base58, 32–44 chars (after BTC is ruled out).
 *  SKR/mSOL share the same address format as SOL — user must select manually.
 */
function detectChain(address: string): "eth" | "btc" | "sol" | null {
  if (/^0x[0-9a-fA-F]{40}$/.test(address)) return "eth";
  if (/^(1|3)[a-zA-Z0-9]{25,34}$|^bc1[a-zA-Z0-9]{6,87}$/.test(address))
    return "btc";
  // Solana base58: characters 1-9 A-H J-N P-Z a-k m-z (no 0, O, I, l)
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) return "sol";
  return null;
}

const CHAIN_OPTIONS = [
  { value: "auto", label: "Auto-detect" },
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
}

export function CryptoWatchModal({
  opened,
  onClose,
  onAdded,
  assetAccounts,
  linkedAccountIds,
}: Props) {
  const { t, locale } = useLang();
  const { prices } = useAppData();

  const [address, setAddress] = useState("");
  const [chainSelect, setChainSelect] = useState<string>("auto");
  const [accountId, setAccountId] = useState<string | null>(null);
  const [balance, setBalance] = useState<CryptoBalance | null>(null);
  const [fetching, setFetching] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Effective chain: manual selection wins over auto-detect
  const effectiveChain: CryptoChain | null =
    chainSelect !== "auto"
      ? (chainSelect as CryptoChain)
      : detectChain(address.trim());

  const isAddressNonEmpty = address.trim().length > 0;

  const availableAccounts = assetAccounts
    .filter((a) => !linkedAccountIds.has(a.id) && isUserSelectableAccount(a))
    .slice()
    .sort(
      (a, b) =>
        categoryIndex(a.type, a.category, a.is_system ?? false) -
        categoryIndex(b.type, b.category, b.is_system ?? false),
    );

  function getPriceForChain(chain: CryptoChain): number | null {
    if (!prices) return null;
    if (chain === "eth") return prices.ethereum;
    if (chain === "btc") return prices.bitcoin;
    if (chain === "sol") return prices.solana;
    if (chain === "skr") return prices.skr;
    if (chain === "msol") return prices.solana; // mSOL valued in SOL terms
    if (chain === "sol_stake") return prices.solana; // native stake valued in SOL
    return null;
  }

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
    setChainSelect("auto");
    setAccountId(null);
    setBalance(null);
    setError(null);
    onClose();
  }

  const coinPrice = balance ? getPriceForChain(balance.chain) : null;
  const estValue =
    balance && coinPrice !== null ? balance.amount * coinPrice : null;

  const chainLabel =
    effectiveChain === "eth"
      ? "Ethereum"
      : effectiveChain === "btc"
        ? "Bitcoin"
        : effectiveChain === "sol"
          ? "Solana"
          : effectiveChain === "skr"
            ? "Seeker (SKR)"
            : effectiveChain === "msol"
              ? "Marinade mSOL"
              : effectiveChain === "sol_stake"
                ? "SOL Stake"
                : null;

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
          data={CHAIN_OPTIONS}
          value={chainSelect}
          onChange={(v) => {
            setChainSelect(v ?? "auto");
            setBalance(null);
          }}
        />

        <TextInput
          label={t("walletAddress")}
          placeholder="0x... or bc1... or 1..."
          value={address}
          onChange={(e) => {
            setAddress(e.currentTarget.value);
            setBalance(null);
          }}
          rightSection={
            isAddressNonEmpty && chainSelect === "auto" ? (
              <Badge
                size="sm"
                color={chainLabel ? "teal" : "red"}
                variant="filled"
              >
                {chainLabel ?? t("invalidAddress")}
              </Badge>
            ) : null
          }
          rightSectionWidth={chainLabel ? 100 : 120}
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
              {balance.amount.toFixed(4)} {balance.chain.toUpperCase()}
              {estValue !== null && (
                <Text span c="dimmed" ml={4}>
                  ≈ {formatJPY(estValue, locale)}
                </Text>
              )}
            </Text>
          )}
        </Group>

        {balance && estValue !== null && coinPrice !== null && (
          <Paper withBorder p="xs" radius="sm">
            <Group justify="space-between">
              <Text size="xs" c="dimmed">
                {t("quantity")}
              </Text>
              <Text size="xs" fw={500}>
                {balance.amount.toFixed(6)} {balance.chain.toUpperCase()}
              </Text>
            </Group>
            <Group justify="space-between">
              <Text size="xs" c="dimmed">
                {t("coinPrice")}
              </Text>
              <Text size="xs">{formatJPY(coinPrice, locale)}</Text>
            </Group>
            <Group justify="space-between">
              <Text size="xs" c="dimmed">
                {t("estMarketValue")}
              </Text>
              <Text size="xs" fw={700} c="teal">
                {formatJPY(estValue, locale)}
              </Text>
            </Group>
          </Paper>
        )}

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
