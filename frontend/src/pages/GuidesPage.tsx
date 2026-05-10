import {
  Anchor,
  Box,
  Button,
  Divider,
  Group,
  NavLink,
  ScrollArea,
  Select,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import {
  IconArrowLeft,
  IconArrowRight,
  IconBook,
  IconChevronDown,
} from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useLang, type Locale } from "../i18n";
import classes from "./GuidesPage.module.css";

import raw01En from "../guides/en/01-overview.md?raw";
import raw02En from "../guides/en/02-double-entry.md?raw";
import raw03En from "../guides/en/03-budget.md?raw";
import raw04En from "../guides/en/04-trial-balance.md?raw";
import raw05En from "../guides/en/05-depreciation.md?raw";
import raw06En from "../guides/en/06-loans.md?raw";
import raw07En from "../guides/en/07-crypto.md?raw";
import raw08En from "../guides/en/08-currencies.md?raw";
import raw01Ja from "../guides/01-overview.md?raw";
import raw02Ja from "../guides/02-double-entry.md?raw";
import raw03Ja from "../guides/03-budget.md?raw";
import raw04Ja from "../guides/04-trial-balance.md?raw";
import raw05Ja from "../guides/05-depreciation.md?raw";
import raw06Ja from "../guides/06-loans.md?raw";
import raw07Ja from "../guides/07-crypto.md?raw";
import raw08Ja from "../guides/08-currencies.md?raw";

type GuideFrontmatter = {
  id: string;
  titleJa: string;
  titleEn: string;
};

type GuideSection = GuideFrontmatter & {
  content: string;
};

type GuideLocale = Extract<Locale, "ja" | "en">;

type LocalizedGuideSection = GuideFrontmatter & {
  content: Record<GuideLocale, string>;
};

function parseGuide(raw: string): GuideSection {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return { id: "", titleJa: "", titleEn: "", content: raw };
  const fm: Record<string, string> = {};
  for (const line of match[1]!.split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    fm[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
  }
  return {
    id: fm["id"] ?? "",
    titleJa: fm["titleJa"] ?? "",
    titleEn: fm["titleEn"] ?? "",
    content: match[2]!,
  };
}

function createLocalizedGuide(
  jaRaw: string,
  enRaw: string,
): LocalizedGuideSection {
  const ja = parseGuide(jaRaw);
  const en = parseGuide(enRaw);

  return {
    id: ja.id || en.id,
    titleJa: ja.titleJa || en.titleJa,
    titleEn: en.titleEn || ja.titleEn,
    content: {
      ja: ja.content,
      en: en.content,
    },
  };
}

function guideTitle(section: GuideFrontmatter, locale: Locale) {
  return locale === "ja" ? section.titleJa : section.titleEn;
}

const GUIDE_SECTIONS: LocalizedGuideSection[] = [
  createLocalizedGuide(raw01Ja, raw01En),
  createLocalizedGuide(raw02Ja, raw02En),
  createLocalizedGuide(raw03Ja, raw03En),
  createLocalizedGuide(raw04Ja, raw04En),
  createLocalizedGuide(raw05Ja, raw05En),
  createLocalizedGuide(raw06Ja, raw06En),
  createLocalizedGuide(raw07Ja, raw07En),
  createLocalizedGuide(raw08Ja, raw08En),
];

function NavButtons({
  activeIndex,
  onNavigate,
  locale,
  isMobile,
}: {
  activeIndex: number;
  onNavigate: (index: number) => void;
  locale: Locale;
  isMobile?: boolean;
}) {
  const prev = GUIDE_SECTIONS[activeIndex - 1];
  const next = GUIDE_SECTIONS[activeIndex + 1];
  const borderStyle = "1px solid light-dark(#dee2e6, #373a40)";

  if (isMobile) {
    return (
      <Stack mt="xl" pt="md" gap="xs" style={{ borderTop: borderStyle }}>
        {next && (
          <Button
            variant="light"
            rightSection={<IconArrowRight size={14} />}
            onClick={() => onNavigate(activeIndex + 1)}
            fullWidth
          >
            {guideTitle(next, locale)}
          </Button>
        )}
        {prev && (
          <Button
            variant="subtle"
            leftSection={<IconArrowLeft size={14} />}
            onClick={() => onNavigate(activeIndex - 1)}
            fullWidth
            color="gray"
          >
            {guideTitle(prev, locale)}
          </Button>
        )}
      </Stack>
    );
  }

  return (
    <Group
      justify="space-between"
      mt="xl"
      pt="md"
      style={{ borderTop: borderStyle }}
    >
      {prev ? (
        <Button
          variant="subtle"
          leftSection={<IconArrowLeft size={14} />}
          onClick={() => onNavigate(activeIndex - 1)}
          size="sm"
          style={{ minWidth: 0, flex: 1 }}
        >
          <Text size="sm" lineClamp={1}>
            {guideTitle(prev, locale)}
          </Text>
        </Button>
      ) : (
        <div style={{ flex: 1 }} />
      )}
      {next ? (
        <Button
          variant="subtle"
          rightSection={<IconArrowRight size={14} />}
          onClick={() => onNavigate(activeIndex + 1)}
          size="sm"
          style={{ minWidth: 0, flex: 1 }}
        >
          <Text size="sm" lineClamp={1}>
            {guideTitle(next, locale)}
          </Text>
        </Button>
      ) : (
        <div style={{ flex: 1 }} />
      )}
    </Group>
  );
}

export default function GuidesPage() {
  const { t, locale } = useLang();
  const [activeId, setActiveId] = useState(GUIDE_SECTIONS[0]!.id);
  const isMobile = useMediaQuery("(max-width: 768px)");
  const contentRef = useRef<HTMLDivElement>(null);

  const activeIndex = GUIDE_SECTIONS.findIndex((s) => s.id === activeId);
  const activeSection = GUIDE_SECTIONS[activeIndex]!;

  const selectData = GUIDE_SECTIONS.map((s, i) => ({
    value: s.id,
    label: `${i + 1}. ${guideTitle(s, locale)}`,
  }));

  const handleNavigate = (index: number) => {
    setActiveId(GUIDE_SECTIONS[index]!.id);
    contentRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  useEffect(() => {
    if (isMobile) {
      contentRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }
  }, [activeId, isMobile]);

  return (
    <Stack gap="md">
      <Group gap="xs">
        <IconBook size={18} />
        <Title order={4}>{t("guidesPageTitle")}</Title>
      </Group>

      <Anchor component={Link} to="/settings" size="sm">
        {t("settingsSubpageBack")}
      </Anchor>

      <Divider />

      {isMobile ? (
        /* Mobile layout: dropdown selector + full-width content */
        <Stack gap="md">
          <Select
            data={selectData}
            value={activeId}
            onChange={(v) => v && setActiveId(v)}
            rightSection={<IconChevronDown size={14} />}
            styles={{ input: { fontWeight: 500 } }}
          />
          <Box ref={contentRef} className={classes.markdown}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {activeSection.content[locale === "ja" ? "ja" : "en"]}
            </ReactMarkdown>
            <NavButtons
              activeIndex={activeIndex}
              onNavigate={handleNavigate}
              locale={locale}
              isMobile
            />
          </Box>
        </Stack>
      ) : (
        /* Desktop layout: sidebar + content */
        <Group align="flex-start" gap="lg" wrap="nowrap">
          <ScrollArea w={200} style={{ flexShrink: 0 }}>
            <Stack gap={2}>
              {GUIDE_SECTIONS.map((section) => (
                <NavLink
                  key={section.id}
                  label={guideTitle(section, locale)}
                  active={activeId === section.id}
                  onClick={() => setActiveId(section.id)}
                  style={{ borderRadius: 6 }}
                />
              ))}
            </Stack>
          </ScrollArea>

          <Divider orientation="vertical" />

          <Box style={{ flex: 1, minWidth: 0 }}>
            <div ref={contentRef} className={classes.markdown}>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {activeSection.content[locale === "ja" ? "ja" : "en"]}
              </ReactMarkdown>
              <NavButtons
                activeIndex={activeIndex}
                onNavigate={handleNavigate}
                locale={locale}
              />
            </div>
          </Box>
        </Group>
      )}
    </Stack>
  );
}
