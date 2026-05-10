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
          border: "rgba(224, 49, 49, 0.28)",
          background: "rgba(255, 245, 245, 0.88)",
          text: "#c92a2a",
        }
      : item?.color === "orange" || item?.color === "yellow"
        ? {
            icon: <IconAlertTriangle size={16} />,
            badge: "yellow",
            border: "rgba(245, 159, 0, 0.28)",
            background: "rgba(255, 249, 219, 0.92)",
            text: "#8f5b00",
          }
        : item?.color === "teal"
          ? {
              icon: <IconCircleCheck size={16} />,
              badge: "teal",
              border: "rgba(18, 184, 134, 0.28)",
              background: "rgba(230, 252, 245, 0.92)",
              text: "#087f5b",
            }
          : {
              icon: <IconInfoCircle size={16} />,
              badge: "blue",
              border: "rgba(34, 139, 230, 0.24)",
              background: "rgba(231, 245, 255, 0.9)",
              text: "#1864ab",
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
