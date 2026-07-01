import { useEffect, useMemo, useState } from "react";
import {
  Anchor,
  Badge,
  Button,
  Group,
  PasswordInput,
  SimpleGrid,
  Skeleton,
  Stack,
  Text,
  Title,
  rem,
} from "@mantine/core";
import { Link } from "react-router-dom";
import { IconArrowLeft, IconDeviceFloppy, IconKey, IconTrash } from "@tabler/icons-react";
import type {
  ProductApiCredentialStatus,
  ProductApiProvider,
  UpsertProductApiCredentialInput,
} from "@balance-sheet/shared";
import { api } from "../api/client";
import { useLang } from "../i18n";
import { showFeedback } from "../lib/feedback";

type ProductApiCredentialField = keyof UpsertProductApiCredentialInput;

function emptyProductApiCredentialForm(): UpsertProductApiCredentialInput {
  return {
    api_key: "",
    api_secret: "",
    partner_tag: "",
    application_id: "",
  };
}

function isProviderConfigured(
  provider: ProductApiProvider,
  status?: ProductApiCredentialStatus,
) {
  if (!status) return false;
  if (provider === "amazon") {
    return status.has_api_key && status.has_api_secret && status.has_partner_tag;
  }
  if (provider === "rakuten") {
    return status.has_application_id && status.has_api_key;
  }
  return status.has_application_id;
}

export default function ProductApiSettingsPage() {
  const { t } = useLang();
  const [statuses, setStatuses] = useState<ProductApiCredentialStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingProvider, setSavingProvider] =
    useState<ProductApiProvider | null>(null);
  const [forms, setForms] = useState<
    Record<ProductApiProvider, UpsertProductApiCredentialInput>
  >({
    rakuten: emptyProductApiCredentialForm(),
    yahoo: emptyProductApiCredentialForm(),
    amazon: emptyProductApiCredentialForm(),
  });

  useEffect(() => {
    let active = true;
    setLoading(true);
    api.productApiCredentials
      .list()
      .then((rows) => {
        if (active) setStatuses(rows);
      })
      .catch((error) => {
        if (active) {
          showFeedback({
            message:
              error instanceof Error ? error.message : t("failedToLoadData"),
            color: "red",
          });
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [t]);

  const statusByProvider = useMemo(
    () => new Map(statuses.map((status) => [status.provider, status])),
    [statuses],
  );

  const providerConfigs = [
    {
      provider: "rakuten" as const,
      label: t("productApiProviderRakuten"),
      description: t("productApiProviderRakutenDesc"),
      fields: [
        {
          field: "application_id" as const,
          label: t("productApiApplicationId"),
        },
        { field: "api_key" as const, label: t("productApiAccessKey") },
      ],
      guide: t("productApiGuideRakuten"),
      docsUrl: "https://webservice.rakuten.co.jp/documentation/ichiba-item-search",
    },
    {
      provider: "yahoo" as const,
      label: t("productApiProviderYahoo"),
      description: t("productApiProviderYahooDesc"),
      fields: [
        {
          field: "application_id" as const,
          label: t("productApiApplicationId"),
        },
      ],
      guide: t("productApiGuideYahoo"),
      docsUrl: "https://developer.yahoo.co.jp/webapi/shopping/v3/itemsearch.html",
    },
    {
      provider: "amazon" as const,
      label: t("productApiProviderAmazon"),
      description: t("productApiProviderAmazonDesc"),
      fields: [
        { field: "api_key" as const, label: t("productApiAccessKey") },
        { field: "api_secret" as const, label: t("productApiSecretKey") },
        { field: "partner_tag" as const, label: t("productApiPartnerTag") },
      ],
      guide: t("productApiGuideAmazon"),
      docsUrl: "https://webservices.amazon.com/paapi5/documentation/",
    },
  ];

  const updateField = (
    provider: ProductApiProvider,
    field: ProductApiCredentialField,
    value: string,
  ) => {
    setForms((current) => ({
      ...current,
      [provider]: {
        ...current[provider],
        [field]: value,
      },
    }));
  };

  const currentLast4 = (
    status: ProductApiCredentialStatus | undefined,
    field: ProductApiCredentialField,
  ) => {
    if (!status) return null;
    if (field === "api_key") return status.api_key_last4;
    if (field === "partner_tag") return status.partner_tag_last4;
    if (field === "application_id") return status.application_id_last4;
    return null;
  };

  const saveProvider = async (provider: ProductApiProvider) => {
    const input = forms[provider];
    const payload = Object.fromEntries(
      Object.entries(input).filter(([, value]) => value?.trim()),
    ) as UpsertProductApiCredentialInput;

    if (Object.keys(payload).length === 0) {
      showFeedback({
        message: t("productApiSettingsNoInput"),
        color: "red",
      });
      return;
    }

    setSavingProvider(provider);
    try {
      const updated = await api.productApiCredentials.upsert(provider, payload);
      setStatuses((current) => [
        ...current.filter((status) => status.provider !== provider),
        updated,
      ]);
      setForms((current) => ({
        ...current,
        [provider]: emptyProductApiCredentialForm(),
      }));
      showFeedback({
        message: t("productApiSettingsSaved"),
        color: "teal",
      });
    } catch (error) {
      showFeedback({
        message:
          error instanceof Error ? error.message : t("internalServerError"),
        color: "red",
      });
    } finally {
      setSavingProvider(null);
    }
  };

  const clearProvider = async (provider: ProductApiProvider) => {
    if (!window.confirm(t("productApiSettingsClearConfirm"))) return;
    setSavingProvider(provider);
    try {
      await api.productApiCredentials.delete(provider);
      setStatuses((current) =>
        current.filter((status) => status.provider !== provider),
      );
      setForms((current) => ({
        ...current,
        [provider]: emptyProductApiCredentialForm(),
      }));
      showFeedback({
        message: t("productApiSettingsCleared"),
        color: "teal",
      });
    } catch (error) {
      showFeedback({
        message:
          error instanceof Error ? error.message : t("internalServerError"),
        color: "red",
      });
    } finally {
      setSavingProvider(null);
    }
  };

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-start">
        <Stack gap={4}>
          <Group gap="xs">
            <IconKey size={20} />
            <Title order={3}>{t("productApiSettingsTitle")}</Title>
          </Group>
          <Text size="sm" c="dimmed">
            {t("productApiSettingsDescription")}
          </Text>
        </Stack>
        <Button
          component={Link}
          to="/settings"
          variant="default"
          size="xs"
          leftSection={<IconArrowLeft size={14} />}
        >
          {t("settingsSubpageBack")}
        </Button>
      </Group>

      {loading ? (
        <Stack gap="sm">
          <Skeleton height={120} />
          <Skeleton height={120} />
          <Skeleton height={160} />
        </Stack>
      ) : (
        <Stack gap="md">
          {providerConfigs.map((config) => {
            const status = statusByProvider.get(config.provider);
            const configured = isProviderConfigured(config.provider, status);
            return (
              <Stack
                key={config.provider}
                gap="xs"
                style={{
                  borderTop: "1px solid var(--mantine-color-default-border)",
                  paddingTop: rem(16),
                }}
              >
                <Stack gap={2}>
                  <Group gap="xs">
                    <Text fw={600}>{config.label}</Text>
                    <Badge
                      size="sm"
                      color={configured ? "green" : "gray"}
                      variant="light"
                    >
                      {configured
                        ? t("productApiConfigured")
                        : t("productApiNotConfigured")}
                    </Badge>
                  </Group>
                  <Text size="sm" c="dimmed">
                    {config.description}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {config.guide}{" "}
                    <Anchor
                      href={config.docsUrl}
                      target="_blank"
                      rel="noreferrer"
                      size="xs"
                    >
                      {t("productApiGuideOpenDocs")}
                    </Anchor>
                  </Text>
                </Stack>

                <SimpleGrid cols={{ base: 1, md: config.fields.length }}>
                  {config.fields.map((fieldConfig) => {
                    const last4 = currentLast4(status, fieldConfig.field);
                    return (
                      <PasswordInput
                        key={fieldConfig.field}
                        label={fieldConfig.label}
                        value={forms[config.provider][fieldConfig.field] ?? ""}
                        onChange={(event) =>
                          updateField(
                            config.provider,
                            fieldConfig.field,
                            event.currentTarget.value,
                          )
                        }
                        placeholder={
                          last4
                            ? `${t("productApiSettingsConfiguredLast4")} ${last4}`
                            : t("productApiSettingsLeaveBlank")
                        }
                        autoComplete="off"
                      />
                    );
                  })}
                </SimpleGrid>

                <Group justify="flex-end" gap="xs">
                  <Button
                    variant="default"
                    leftSection={<IconTrash size={14} />}
                    disabled={!configured || savingProvider === config.provider}
                    onClick={() => void clearProvider(config.provider)}
                  >
                    {t("productApiClear")}
                  </Button>
                  <Button
                    leftSection={<IconDeviceFloppy size={14} />}
                    loading={savingProvider === config.provider}
                    onClick={() => void saveProvider(config.provider)}
                  >
                    {t("productApiSave")}
                  </Button>
                </Group>
              </Stack>
            );
          })}
        </Stack>
      )}
    </Stack>
  );
}
