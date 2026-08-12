import { Badge, Group, Paper, Text, Transition } from "@mantine/core";
import {
  IconAlertCircle,
  IconAlertTriangle,
  IconCircleCheck,
  IconInfoCircle,
} from "@tabler/icons-react";
import { useSyncExternalStore } from "react";
import {
  clearFeedback,
  getFeedbackSnapshot,
  subscribeFeedback,
} from "../lib/feedback";
import { useLang } from "../i18n";

export function FeedbackHost() {
  const { t } = useLang();
  const item = useSyncExternalStore(
    subscribeFeedback,
    getFeedbackSnapshot,
    getFeedbackSnapshot,
  );

  const tone =
    item?.color === "red"
      ? {
          icon: <IconAlertCircle size={16} />,
          badge: "red",
          border: "var(--mantine-color-red-outline)",
          background: "var(--mantine-color-red-light)",
          text: "var(--mantine-color-red-light-color)",
        }
      : item?.color === "orange" || item?.color === "yellow"
        ? {
            icon: <IconAlertTriangle size={16} />,
            badge: "yellow",
            border: "var(--mantine-color-yellow-outline)",
            background: "var(--mantine-color-yellow-light)",
            text: "var(--mantine-color-yellow-light-color)",
          }
        : item?.color === "teal"
          ? {
              icon: <IconCircleCheck size={16} />,
              badge: "teal",
              border: "var(--mantine-color-teal-outline)",
              background: "var(--mantine-color-teal-light)",
              text: "var(--mantine-color-teal-light-color)",
            }
          : {
              icon: <IconInfoCircle size={16} />,
              badge: "blue",
              border: "var(--mantine-color-blue-outline)",
              background: "var(--mantine-color-blue-light)",
              text: "var(--mantine-color-blue-light-color)",
            };

  return (
    <Transition
      mounted={item != null}
      transition="slide-up"
      duration={180}
      timingFunction="ease"
    >
      {(styles) => (
        <div
          style={{
            ...styles,
            position: "fixed",
            left: "50%",
            bottom: "calc(76px + env(safe-area-inset-bottom, 0px))",
            transform: "translateX(-50%)",
            width: "min(560px, calc(100vw - 24px))",
            zIndex: 400,
            pointerEvents: "none",
          }}
        >
          <Paper
            withBorder
            radius="xl"
            px="md"
            py="sm"
            shadow="md"
            style={{
              borderColor: tone.border,
              background: tone.background,
              backdropFilter: "blur(10px)",
              pointerEvents: "auto",
            }}
          >
            {item && (
              <Group justify="space-between" gap="sm" wrap="nowrap">
                <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
                  <Badge variant="dot" color={tone.badge}>
                    {t("statusLabel")}
                  </Badge>
                  <Text span c={tone.text}>
                    {tone.icon}
                  </Text>
                  <Text size="sm" fw={600} c={tone.text} style={{ minWidth: 0 }}>
                    {item.message}
                  </Text>
                </Group>
                <Text
                  component="button"
                  type="button"
                  size="xs"
                  c="dimmed"
                  onClick={clearFeedback}
                  style={{
                    border: 0,
                    background: "transparent",
                    cursor: "pointer",
                    padding: 0,
                    flexShrink: 0,
                  }}
                >
                  {t("statusDismiss")}
                </Text>
              </Group>
            )}
          </Paper>
        </div>
      )}
    </Transition>
  );
}
