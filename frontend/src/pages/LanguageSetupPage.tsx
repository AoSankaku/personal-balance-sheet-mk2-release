import { Button, Paper, Stack, Text, Title } from "@mantine/core";
import type { CSSProperties } from "react";
import { useLang, type Locale } from "../i18n";
import * as Flags from "country-flag-icons/react/1x1";

const options: { value: Locale; label: string; nativeLabel: string; country: string }[] =
  [
    { value: "ja", label: "Japanese", nativeLabel: "日本語", country: "JP" },
    { value: "en", label: "English", nativeLabel: "English", country: "US" },
    { value: "fr", label: "French", nativeLabel: "Français", country: "FR" },
    { value: "es", label: "Spanish", nativeLabel: "Español", country: "ES" },
    {
      value: "zh-CN",
      label: "Chinese (Simplified)",
      nativeLabel: "简体中文",
      country: "CN",
    },
    {
      value: "zh-TW",
      label: "Chinese (Traditional)",
      nativeLabel: "繁體中文",
      country: "TW",
    },
  ];

function Flag({ country }: { country: string }) {
  const Svg = (
    Flags as unknown as Record<
      string,
      (props: { style?: CSSProperties }) => JSX.Element
    >
  )[country];
  if (!Svg) return null;
  return <Svg style={{ width: 20, height: 20, display: "block" }} />;
}

export default function LanguageSetupPage() {
  const { locale, setLocale } = useLang();

  return (
    <Stack maw={520} mx="auto" mt="xl" gap="md">
      <Paper withBorder p="lg" radius="md">
        <Stack gap="sm">
          <Title order={3}>Choose your language / 言語を選択</Title>
          <Text size="sm" c="dimmed">
            Select your language before configuring currencies.
          </Text>
          <Stack gap="xs" mt="xs">
            {options.map((option) => (
              <Button
                key={option.value}
                variant={locale === option.value ? "filled" : "light"}
                justify="space-between"
                leftSection={<Flag country={option.country} />}
                onClick={() => setLocale(option.value)}
                fullWidth
              >
                {option.nativeLabel} ({option.label})
              </Button>
            ))}
          </Stack>
        </Stack>
      </Paper>
    </Stack>
  );
}
