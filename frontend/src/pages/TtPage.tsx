import {
  Anchor,
  Divider,
  ScrollArea,
  SegmentedControl,
  Skeleton,
  Stack,
  Title,
} from "@mantine/core";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type {
  ActualBalanceSnapshot,
  CreditCardStateEntry,
} from "@balance-sheet/shared";
import { api } from "../api/client";
import { useLang } from "../i18n";
import { useAppData } from "../context/AppDataContext";
import { ActualInputSection } from "../components/tt/ActualInputSection";
import { DeviationSection } from "../components/tt/DeviationSection";
import { BudgetCheckSection } from "../components/tt/BudgetCheckSection";
import { UnknownFundsSection } from "../components/tt/UnknownFundsSection";
import { AppDataErrorAlert } from "../components/AppDataErrorAlert";

// ──────────────────────────────────────────────
// Main page
// ──────────────────────────────────────────────

const SEGMENTS = ["actual", "deviation", "budget", "unknown"] as const;
type Segment = (typeof SEGMENTS)[number];

function getSegmentParam(searchParams: URLSearchParams): Segment {
  const segment = searchParams.get("segment");
  return SEGMENTS.includes(segment as Segment) ? (segment as Segment) : "actual";
}

export default function TtPage() {
  const { t } = useLang();
  const { loading, error, refreshLatestTrialBalanceDate } = useAppData();
  const [searchParams, setSearchParams] = useSearchParams();

  const segment = getSegmentParam(searchParams);
  const [snapshots, setSnapshots] = useState<ActualBalanceSnapshot[] | null>(
    null,
  );
  const [snapshotsLoading, setSnapshotsLoading] = useState(false);
  const [snapshotsLoaded, setSnapshotsLoaded] = useState(false);
  const [ccState, setCcState] = useState<CreditCardStateEntry[]>([]);

  useEffect(() => {
    api.trialBalance
      .getCreditCardState()
      .then(setCcState)
      .catch(() => {});
  }, []);

  async function loadSnapshots() {
    if (snapshotsLoaded) return;
    setSnapshotsLoading(true);
    try {
      const data = await api.trialBalance.listSnapshots();
      setSnapshots(data);
      void refreshLatestTrialBalanceDate();
    } catch {
      setSnapshots([]);
    } finally {
      setSnapshotsLoading(false);
      setSnapshotsLoaded(true);
    }
  }

  async function reloadSnapshots() {
    setSnapshotsLoaded(false);
    setSnapshotsLoading(true);
    try {
      const data = await api.trialBalance.listSnapshots();
      setSnapshots(data);
      void refreshLatestTrialBalanceDate();
    } catch {
      // keep existing
    } finally {
      setSnapshotsLoading(false);
      setSnapshotsLoaded(true);
    }
  }

  function updateSegment(seg: Segment) {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set("segment", seg);
    setSearchParams(nextParams, { replace: true });
  }

  // Load snapshots when the URL opens a tab that needs them.
  useEffect(() => {
    if (segment === "deviation" || segment === "unknown") {
      loadSnapshots();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segment]);

  // Load snapshots when switching to deviation tab
  function handleSegmentChange(val: string) {
    const seg = val as Segment;
    updateSegment(seg);
    if (seg === "deviation" || seg === "unknown") {
      loadSnapshots();
    }
  }

  function handleSnapshotSaved(snapshot: ActualBalanceSnapshot) {
    setSnapshots((prev) => (prev ? [snapshot, ...prev] : [snapshot]));
    setSnapshotsLoaded(true);
    updateSegment("deviation");
  }

  if (loading) {
    return (
      <Stack gap="lg">
        <Skeleton height={22} width={120} />
        <Skeleton height={40} radius="md" />
        <Skeleton height={200} radius="md" />
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

      <Title order={3}>{t("tabTrialBalance")}</Title>

      <ScrollArea type="never">
        <SegmentedControl
          value={segment}
          onChange={handleSegmentChange}
          data={[
            { value: "actual", label: t("ttSegActualInput") },
            { value: "deviation", label: t("ttSegDeviation") },
            { value: "unknown", label: t("ttSegUnknownFunds") },
            { value: "budget", label: t("ttSegBudgetCheck") },
          ]}
        />
      </ScrollArea>

      <Divider />

      {segment === "actual" && (
        <ActualInputSection
          onSaved={handleSnapshotSaved}
          onCreditCardStateSaved={setCcState}
        />
      )}

      {segment === "deviation" && (
        <>
          {snapshotsLoading ? (
            <Skeleton height={200} radius="md" />
          ) : (
            <DeviationSection
              snapshots={snapshots ?? []}
              ccState={ccState}
              onJournalCreated={reloadSnapshots}
            />
          )}
        </>
      )}

      {segment === "unknown" && <UnknownFundsSection />}

      {segment === "budget" && <BudgetCheckSection />}
    </Stack>
  );
}
