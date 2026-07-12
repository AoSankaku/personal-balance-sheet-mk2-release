import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

import { getAssetCompositionBar } from "../src/lib/assetCompositionBar";

describe("asset composition bar", () => {
  test("treats total assets as the whole and splits them into liabilities and net worth", () => {
    expect(getAssetCompositionBar(1_000, 400)).toEqual({
      liabilityPercentage: 40,
      netWorthPercentage: 60,
      liabilityBarShare: 40,
      netWorthBarShare: 60,
    });
  });

  test("caps the visual liability share when liabilities exceed assets", () => {
    expect(getAssetCompositionBar(1_000, 1_200)).toEqual({
      liabilityPercentage: 120,
      netWorthPercentage: -20,
      liabilityBarShare: 100,
      netWorthBarShare: 0,
    });
  });

  test("avoids an invalid percentage when there are liabilities but no assets", () => {
    expect(getAssetCompositionBar(0, 100)).toEqual({
      liabilityPercentage: null,
      netWorthPercentage: null,
      liabilityBarShare: 100,
      netWorthBarShare: 0,
    });
  });

  test("uses a subdued neutral outline for the total-assets container", () => {
    const source = readFileSync(
      join(import.meta.dir, "../src/pages/AssetsPage.tsx"),
      "utf8",
    );
    const composition = source.slice(
      source.indexOf("{/* Total assets composed of liabilities and net worth */}"),
      source.indexOf("{/* Assets & Liabilities cards */}"),
    );

    expect(composition).toContain(
      'border: "1px solid var(--mantine-color-default-border)"',
    );
    expect(composition).not.toContain(
      'border: "1px solid var(--mantine-color-teal-6)"',
    );
  });
});
