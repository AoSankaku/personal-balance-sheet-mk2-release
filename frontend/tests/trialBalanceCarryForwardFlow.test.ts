import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const source = (path: string) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("create a new trial balance from an existing snapshot", () => {
  test("offers difference-only and all-value carry-forward choices", () => {
    const deviation = source("src/components/tt/DeviationSection.tsx");

    expect(deviation).toContain('t("ttCreateFromSnapshot")');
    expect(deviation).toContain("buildTrialBalanceCarryForward(snapshot, scope)");
    expect(deviation).toContain('handleCreateFromSnapshot("differences")');
    expect(deviation).toContain('handleCreateFromSnapshot("all")');
    expect(deviation).toContain("onCreateFromSnapshot");
  });

  test("switches to current-value input and assigns a fresh date", () => {
    const page = source("src/pages/TtPage.tsx");
    const actualInput = source("src/components/tt/ActualInputSection.tsx");

    expect(page).toContain("setCarryForwardDraft(draft)");
    expect(page).toContain('updateSegment("actual")');
    expect(actualInput).toContain("initialCarryForwardDraft");
    expect(actualInput).toContain('setMode("general")');
    expect(actualInput).toContain("setDate(new Date())");
    expect(actualInput).toContain("setGeneralValues");
  });

  test("defines the flow copy in the translation key catalog", () => {
    const keys = source("src/i18n/translationKeys.ts");
    for (const key of [
      "ttCreateFromSnapshot",
      "ttCreateFromSnapshotNotice",
      "ttCreateFromSnapshotDifferences",
      "ttCreateFromSnapshotAll",
      "ttCreateFromSnapshotApplied",
    ]) {
      expect(keys).toContain(`"${key}"`);
    }
  });
});
