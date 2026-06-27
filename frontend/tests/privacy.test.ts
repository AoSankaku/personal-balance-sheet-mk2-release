import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  approximatePrivateAmount,
  applyPrivateAccountNames,
  buildPrivateAccountNameMap,
  maskFormattedAmountDigits,
  privateIndexedLabel,
} from "../src/lib/privacy";

describe("privacy formatting", () => {
  test("masks only formatted amount digits while preserving shape", () => {
    expect(maskFormattedAmountDigits("¥123,456")).toBe("¥***,***");
    expect(maskFormattedAmountDigits("-$1,234.50")).toBe("-$*,***.**");
  });

  test("approximates chart values to the leftmost two significant digits", () => {
    expect(approximatePrivateAmount(123456)).toBe(120000);
    expect(approximatePrivateAmount(-98765)).toBe(-98000);
    expect(approximatePrivateAmount(0.12345)).toBe(0.12);
  });

  test("builds stable per-type masked account names", () => {
    const names = buildPrivateAccountNameMap(
      [
        { id: 20, type: "asset", name: "Bank" },
        { id: 10, type: "asset", name: "Cash" },
        { id: 30, type: "income", name: "Salary" },
      ],
      (type) => ({ asset: "資産", income: "収益" })[type] ?? type,
    );

    expect(names.get(10)).toBe("資産01");
    expect(names.get(20)).toBe("資産02");
    expect(names.get(30)).toBe("収益01");
  });
  test("applies account-name masking to fetched account rows", () => {
    const rows = applyPrivateAccountNames(
      [
        { id: 1, type: "asset", name: "Bank" },
        { id: 2, type: "liability", name: "Card" },
        {
          id: 3,
          type: "asset",
          name: "__system:unknown_funds__",
          is_system: true,
        },
      ],
      true,
      true,
      (type) => ({ asset: "Asset", liability: "Liability" })[type] ?? type,
    );

    expect(rows[0]?.name).toBe("Asset01");
    expect(rows[1]?.name).toBe("Liability01");
    expect(rows[2]?.name).toBe("__system:unknown_funds__");
  });

  test("builds private indexed labels for breakdown rows", () => {
    expect(privateIndexedLabel("Asset", 0)).toBe("Asset01");
    expect(privateIndexedLabel("Liability", 11)).toBe("Liability12");
  });

  test("blocks trial balance and loan management routes in privacy mode", () => {
    const source = readFileSync(
      new URL("../src/App.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain('path="/fs/tt"');
    expect(source).toContain('path="/fs/db"');
    expect(source).toContain('path="/fs/db/long-term-loan/:id"');
    expect(source).toContain('path="/fs/db/long-term-lend/:id"');
    expect(source).toContain(
      "element={privacyMode ? <PrivacyModeBlocked /> : <TtPage />}",
    );
    expect(source).toContain(
      "element={privacyMode ? <PrivacyModeBlocked /> : <DbPage />}",
    );
    expect(source).toMatch(
      /privacyMode\s*\?\s*\(\s*<PrivacyModeBlocked\s*\/>\s*\)\s*:\s*\(\s*<LongTermLoanDetailPage kind="loan"\s*\/>\s*\)/,
    );
    expect(source).toMatch(
      /privacyMode\s*\?\s*\(\s*<PrivacyModeBlocked\s*\/>\s*\)\s*:\s*\(\s*<LongTermLoanDetailPage kind="lend"\s*\/>\s*\)/,
    );
  });

  test("blocks crypto wallet edits in privacy mode", () => {
    const source = readFileSync(
      new URL("../src/pages/CryptoPage.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain('from "../context/PrivacyContext"');
    expect(source).toContain("const { privacyMode } = usePrivacy()");
    expect(source).toContain("if (privacyMode) return");
    expect(source).toContain("{!privacyMode && (");
  });

  test("allows account-name masking only while privacy mode is on", () => {
    const settingsSource = readFileSync(
      new URL("../src/pages/SettingsPage.tsx", import.meta.url),
      "utf8",
    );
    const contextSource = readFileSync(
      new URL("../src/context/PrivacyContext.tsx", import.meta.url),
      "utf8",
    );

    expect(settingsSource).toContain("checked={privacyMode && maskAccountNames}");
    expect(settingsSource).toContain("disabled={!privacyMode}");
    expect(contextSource).toContain("if (!privacyMode && enabled) return");
    expect(contextSource).toContain("setMaskAccountNamesState(false)");
    expect(contextSource).toContain(
      "writeStoredBoolean(PRIVACY_MASK_ACCOUNT_NAMES_KEY, false)",
    );
  });
});
