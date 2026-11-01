import {
  Anchor,
  Divider,
  ScrollArea,
  SegmentedControl,
  Skeleton,
  Stack,
  Title,
} from "@mantine/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import type { ActualBalanceSnapshot } from "@balance-sheet/shared";
import { api } from "../api/client";
import { useLang } from "../i18n";
import { useAppData } from "../context/AppDataContext";
import { ActualInputSection } from "../components/tt/ActualInputSection";
import { DeviationSection } from "../components/tt/DeviationSection";
import { UnknownFundsSection } from "../components/tt/UnknownFundsSection";
import { AppDataErrorAlert } from "../components/AppDataErrorAlert";
import type { TrialBalanceCarryForwardDraft } from "../lib/trialBalanceCarryForward";

// ──────────────────────────────────────────────
// Main page
// ──────────────────────────────────────────────

const SEGMENTS = ["actual", "deviation", "unknown"] as const;
type Segment = (typeof SEGMENTS)[number];

function getSegmentParam(searchParams: URLSearchParams): Segment {
  const segment = searchParams.get("segment");
  return SEGMENTS.includes(segment as Segment) ? (segment as Segment) : "actual";
}

export default function TtPage() {
  const { t } = useLang();
  const { loading, error, creditCardState, applyCreditCardState, refreshLatestTrialBalanceDate } = useAppData();
  const [searchParams, setSearchParams] = useSearchParams();

  const segment = getSegmentParam(searchParams);
  const [snapshots, setSnapshots] = useState<ActualBalanceSnapshot[] | null>(
    null,
  );
  const [snapshotsLoading, setSnapshotsLoading] = useState(false);
  const snapshotsLoadedRef = useRef(false);
  const snapshotRequestRef = useRef(0);
  const pendingSnapshotLoadRef = useRef<Promise<void> | null>(null);
  const [carryForwardDraft, setCarryForwardDraft] =
    useState<TrialBalanceCarryForwardDraft | null>(null);
  const legacyBudgetParams = new URLSearchParams(searchParams);
  legacyBudgetParams.delete("segment");
  const legacyBudgetParamsString = legacyBudgetParams.toString();
  const legacyBudgetQuery = legacyBudgetParamsString
    ? `?${legacyBudgetParamsString}`
    : "";

  async function loadSnapshots(force = false) {
    if (snapshotsLoadedRef.current && !force) return;
    if (pendingSnapshotLoadRef.current && !force) return pendingSnapshotLoadRef.current;
    const requestId = ++snapshotRequestRef.current;
    setSnapshotsLoading(true);
    const request = (async () => {
      try {
        const data = await api.trialBalance.listSnapshots();
        if (requestId !== snapshotRequestRef.current) return;
        setSnapshots(data);
        snapshotsLoadedRef.current = true;
        void refreshLatestTrialBalanceDate();
      } catch {
        if (requestId !== snapshotRequestRef.current) return;
        if (!force) setSnapshots([]);
        snapshotsLoadedRef.current = true;
      } finally {
        if (requestId === snapshotRequestRef.current) {
          pendingSnapshotLoadRef.current = null;
          setSnapshotsLoading(false);
        }
      }
    })();
    pendingSnapshotLoadRef.current = request;
    return request;
  }

  async function reloadSnapshots() {
    snapshotsLoadedRef.current = false;
    pendingSnapshotLoadRef.current = null;
    await loadSnapshots(true);
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
  }

  function handleSnapshotSaved(snapshot: ActualBalanceSnapshot) {
    snapshotRequestRef.current += 1;
    pendingSnapshotLoadRef.current = null;
    setSnapshots((prev) => (prev ? [snapshot, ...prev] : [snapshot]));
    snapshotsLoadedRef.current = true;
    setSnapshotsLoading(false);
    updateSegment("deviation");
  }

  function handleCreateFromSnapshot(draft: TrialBalanceCarryForwardDraft) {
    setCarryForwardDraft(draft);
    updateSegment("actual");
  }

  const handleCarryForwardApplied = useCallback(() => {
    setCarryForwardDraft(null);
  }, []);

  if (searchParams.get("segment") === "budget") {
    return <Navigate to={`/fs/budget${legacyBudgetQuery}`} replace />;
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
          ]}
        />
      </ScrollArea>

      <Divider />

      {segment === "actual" && (
        <ActualInputSection
          onSaved={handleSnapshotSaved}
          onCreditCardStateSaved={applyCreditCardState}
          initialCarryForwardDraft={carryForwardDraft}
          onCarryForwardApplied={handleCarryForwardApplied}
        />
      )}

      {segment === "deviation" && (
        <>
          {snapshotsLoading ? (
            <Skeleton height={200} radius="md" />
          ) : (
            <DeviationSection
              snapshots={snapshots ?? []}
              ccState={creditCardState}
              onJournalCreated={reloadSnapshots}
              onCreateFromSnapshot={handleCreateFromSnapshot}
            />
          )}
        </>
      )}

      {segment === "unknown" && <UnknownFundsSection />}
    </Stack>
  );
}
