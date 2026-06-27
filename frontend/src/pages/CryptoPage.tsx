import {
  ActionIcon,
  Anchor,
  Badge,
  Button,
  Group,
  SimpleGrid,
  Skeleton,
  Stack,
  Table,
  Text,
  Title,
  Tooltip,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import {
  IconCurrencyDollar,
  IconRefresh,
  IconTrash,
} from "@tabler/icons-react";
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { toIntlLocale, useLang } from "../i18n";
import { useAppData } from "../context/AppDataContext";
import { usePrivacy } from "../context/PrivacyContext";
import { CryptoWatchModal } from "../components/CryptoWatchModal";
import { AppDataErrorAlert } from "../components/AppDataErrorAlert";
import { showFeedback } from "../lib/feedback";
import { formatJPY } from "../lib/numberFormat";

function truncateAddress(addr: string) {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export default function CryptoPage() {
  const { t, locale } = useLang();
  const { privacyMode } = usePrivacy();
  const {
    accounts,
    cryptoWallets,
    cryptoBalances,
    cryptoValueMap,
    prices,
    loading,
    error,
    refresh,
    refreshCryptoBalances,
    refreshCryptoPrices,
    pricesCooldown,
  } = useAppData();

  const [
    cryptoModalOpened,
    { open: openCryptoModal, close: closeCryptoModal },
  ] = useDisclosure(false);

  const assets = useMemo(
    () => accounts.filter((a) => a.type === "asset"),
    [accounts],
  );

  const linkedAccountIds = useMemo(
    () => new Set(cryptoWallets.map((w) => w.account_id)),
    [cryptoWallets],
  );

  async function handleDeleteWallet(id: number) {
    if (privacyMode) return;
    await api.crypto.delete(id);
    showFeedback({ message: t("deleteWallet"), color: "orange" });
    refresh();
  }

  function handleWalletAdded() {
    showFeedback({ message: t("walletLinked"), color: "teal" });
    closeCryptoModal();
    refresh();
  }

  if (loading) {
    return (
      <Stack gap="lg">
        <Group justify="space-between">
          <Skeleton height={28} width={200} radius="sm" />
          <Group gap="xs">
            <Skeleton height={32} width={32} radius="sm" />
            <Skeleton height={32} width={160} radius="sm" />
            <Skeleton height={32} width={120} radius="sm" />
          </Group>
        </Group>
        <Skeleton height={34} radius="sm" />
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} height={34} radius="sm" />
        ))}
      </Stack>
    );
  }

  if (error) {
    return <AppDataErrorAlert error={error} />;
  }

  return (
    <Stack gap="lg">
      <Anchor component={Link} to="/fs" size="sm" c="dimmed">
        ← {t("navFS")}
      </Anchor>
      <Group justify="space-between" align="center">
        <Title order={4}>{t("cryptoPortfolio")}</Title>
        <Group gap="xs">
          <Tooltip label={t("refresh")}>
            <ActionIcon
              variant="subtle"
              onClick={() => refreshCryptoBalances()}
            >
              <IconRefresh size={16} />
            </ActionIcon>
          </Tooltip>
          <Tooltip
            label={
              pricesCooldown > 0
                ? `${t("refreshPrices")} (${pricesCooldown}s)`
                : t("refreshPrices")
            }
          >
            <ActionIcon
              variant="subtle"
              disabled={pricesCooldown > 0}
              onClick={() => void refreshCryptoPrices()}
            >
              <IconCurrencyDollar size={16} />
            </ActionIcon>
          </Tooltip>
          {!privacyMode && (
            <Button size="sm" onClick={openCryptoModal}>
              {t("addWallet")}
            </Button>
          )}
        </Group>
      </Group>

      {/* Crypto price panel */}
      <Stack gap="xs">
        <Title order={6} c="dimmed">
          {t("cryptoPrices")}
        </Title>
        {!prices ? (
          <Text size="sm" c="dimmed">
            {t("pricesNotLoaded")}
          </Text>
        ) : (
          <SimpleGrid cols={{ base: 3, sm: 4, md: 6 }} spacing="xs">
            {(
              [
                {
                  ticker: "BTC",
                  value: prices.bitcoin,
                  color: "orange",
                  icon: "₿",
                },
                {
                  ticker: "ETH",
                  value: prices.ethereum,
                  color: "violet",
                  icon: "Ξ",
                },
                {
                  ticker: "SOL",
                  value: prices.solana,
                  color: "green",
                  icon: "◎",
                },
                {
                  ticker: "mSOL",
                  value: prices.solana, // mSOL ≈ SOL (exchange rate applied on balance fetch)
                  color: "teal",
                  icon: "M",
                },
                {
                  ticker: "SKR",
                  value: prices.skr,
                  color: "yellow",
                  icon: "S",
                },
                {
                  ticker: "USDT",
                  value: prices.byTicker["USDT"] ?? null,
                  color: "gray",
                  icon: "₮",
                },
              ] as {
                ticker: string;
                value: number | null;
                color: string;
                icon: string;
              }[]
            ).map(({ ticker, value, color, icon }) => (
              <Stack key={ticker} gap={4} align="center">
                <Badge size="lg" color={color} variant="filled" circle>
                  {icon}
                </Badge>
                <Text size="xs" c="dimmed" fw={600}>
                  {ticker}
                </Text>
                <Text size="sm" fw={500}>
                  {value != null
                    ? new Intl.NumberFormat(
                        toIntlLocale(locale),
                        {
                          style: "currency",
                          currency: "JPY",
                          maximumFractionDigits: value >= 100 ? 0 : 2,
                        },
                      ).format(value)
                    : "—"}
                </Text>
              </Stack>
            ))}
          </SimpleGrid>
        )}
      </Stack>

      <Table striped highlightOnHover withTableBorder withColumnBorders>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{t("thAccount")}</Table.Th>
            <Table.Th>{t("thChain")}</Table.Th>
            <Table.Th>{t("thAddress")}</Table.Th>
            <Table.Th className="currency-cell">
              {t("thQuantity")}
            </Table.Th>
            <Table.Th className="currency-cell">
              {t("thEstValue")}
            </Table.Th>
            {!privacyMode && <Table.Th style={{ width: 50 }} />}
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {cryptoWallets.length === 0 ? (
            <Table.Tr>
              <Table.Td colSpan={privacyMode ? 5 : 6}>
                <Text c="dimmed" ta="center" size="sm" py="xs">
                  {t("noWalletsYet")}
                </Text>
              </Table.Td>
            </Table.Tr>
          ) : (
            cryptoWallets.map((w) => {
              const amount = cryptoBalances.get(w.account_id);
              const value = cryptoValueMap.get(w.account_id);
              return (
                <Table.Tr key={w.id}>
                  <Table.Td>
                    <Text size="sm" fw={500}>
                      {w.account_name ?? "—"}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Badge
                      size="sm"
                      color={
                        w.chain === "eth"
                          ? "violet"
                          : w.chain === "btc"
                            ? "orange"
                            : w.chain === "sol"
                              ? "green"
                              : w.chain === "skr"
                                ? "yellow"
                                : w.chain === "msol"
                                  ? "teal"
                                  : w.chain === "sol_stake"
                                    ? "lime"
                                    : "gray"
                      }
                      variant="filled"
                    >
                      {w.chain.toUpperCase()}
                    </Badge>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs" ff="monospace" c="dimmed">
                      {truncateAddress(w.address)}
                    </Text>
                  </Table.Td>
                  <Table.Td className="currency-cell">
                    <Text size="sm">
                      {amount !== undefined
                        ? `${amount.toFixed(4)} ${w.chain.toUpperCase()}`
                        : "—"}
                    </Text>
                  </Table.Td>
                  <Table.Td className="currency-cell">
                    <Text size="sm" fw={500} c="teal">
                      {value !== undefined ? formatJPY(value, locale) : "—"}
                    </Text>
                  </Table.Td>
                  {!privacyMode && (
                    <Table.Td>
                      <Tooltip label={t("deleteWallet")}>
                        <ActionIcon
                          variant="subtle"
                          color="red"
                          size="sm"
                          onClick={() => void handleDeleteWallet(w.id)}
                        >
                          <IconTrash size={14} />
                        </ActionIcon>
                      </Tooltip>
                    </Table.Td>
                  )}
                </Table.Tr>
              );
            })
          )}
        </Table.Tbody>
      </Table>

      {!privacyMode && (
        <CryptoWatchModal
          opened={cryptoModalOpened}
          onClose={closeCryptoModal}
          onAdded={handleWalletAdded}
          assetAccounts={assets}
          linkedAccountIds={linkedAccountIds}
        />
      )}
    </Stack>
  );
}
