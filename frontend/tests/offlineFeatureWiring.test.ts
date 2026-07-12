import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

const root = join(import.meta.dir, "..");
const source = (path: string) => readFileSync(join(root, path), "utf8");

describe("offline feature wiring", () => {
  test("restores cached app data when the initial API refresh is offline", () => {
    const context = source("src/context/AppDataContext.tsx");
    expect(context).toContain("initialOfflineCache?.accounts ?? []");
    expect(context).toContain("cached.todayBudget?.summary ?? null");
    expect(context).toContain("todayBudget: {");
  });

  test("uses today's matching cached budget snapshot on overview fetch failure", () => {
    const overview = source("src/pages/OverviewPage.tsx");
    expect(overview).toContain("getCachedTodayBudgetSummary(");
    expect(overview).toContain("summary: cached?.summary ?? null");
    expect(overview).toContain('t("offlineBudgetSnapshotNotice")');
  });

  test("queues offline simple entries and exposes them as resumable tasks", () => {
    const input = source("src/pages/InputPage.tsx");
    const nav = source("src/components/TopNav.tsx");
    expect(input).toContain('submitLabel={!isOnline ? t("saveOfflineDraft")');
    expect(input).toContain("addOfflineDraft(draft)");
    expect(input).toContain("locationOfflineDraft?.draft");
    expect(nav).toContain("pendingOfflineDrafts.map");
    expect(nav).toContain("offlineDraftId: draft.id");
  });
});
