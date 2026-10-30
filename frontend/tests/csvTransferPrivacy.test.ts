import { describe, expect, test } from "bun:test";
import {
  getCsvImportDescription,
  maskKotoraTransferNumber,
  parseKotoraAutoMaskPreference,
  reviewKotoraTransferDescriptions,
} from "../src/lib/csvTransferPrivacy";

const original = "ことら送金　タナカ　タロウ （20261234567890123456）";
const masked = "ことら送金　タナカ　タロウ （****）";

describe("Kotora bank-import description review", () => {
  test("warns for the supplied bank syntax and preserves the original by default", () => {
    const descriptions = [original, "スーパーで買い物"];
    expect(reviewKotoraTransferDescriptions("docomo-smtb-bank", descriptions, false))
      .toEqual({ descriptions, warningIndices: [0], maskedCount: 0 });
    expect(descriptions[0]).toBe(original);
  });

  test("masks only the transfer number when explicitly requested, retaining the name", () => {
    expect(reviewKotoraTransferDescriptions("docomo-smtb-bank", [original], true))
      .toEqual({ descriptions: [masked], warningIndices: [], maskedCount: 1 });
    expect(maskKotoraTransferNumber(original)).toBe(masked);
    expect(maskKotoraTransferNumber(masked)).toBe(masked);
  });

  test("supports the same syntax in other bank formats, receipts, and width variants", () => {
    const variants = [
      ["ことら送金 タナカ タロウ (20261234567890123456)", "ことら送金 タナカ タロウ (****)"],
      ["コトラ送金　タナカ　タロウ（２０２６１２３４５６７８９０１２３４５６）", "コトラ送金　タナカ　タロウ（****）"],
      ["ｺﾄﾗｿｳｷﾝ ﾀﾅｶ ﾀﾛｳ (1234567890)", "ｺﾄﾗｿｳｷﾝ ﾀﾅｶ ﾀﾛｳ (****)"],
      [" ことら送金 サトウ(個人) ( 12345678901234567890 )  ", " ことら送金 サトウ(個人) (****)  "],
    ];
    for (const [description, expected] of variants) {
      expect(reviewKotoraTransferDescriptions("smbc-bank", [description!], false).warningIndices).toEqual([0]);
      expect(maskKotoraTransferNumber(description!)).toBe(expected!);
    }
  });

  test("does not alter card descriptions, unrelated transfers, fees, or rewritten notes", () => {
    expect(reviewKotoraTransferDescriptions("smbc-confirmed", [original], true))
      .toEqual({ descriptions: [original], warningIndices: [], maskedCount: 0 });
    expect(reviewKotoraTransferDescriptions("unknown", [original], false).warningIndices).toEqual([]);
    const safe = ["振込 タナカ (20261234567890123456)", "ことら送金手数料", "旅行代の精算", "ことら送金 タナカ", masked, "ことら送金（1234567890）"];
    expect(reviewKotoraTransferDescriptions("smbc-bank", safe, true))
      .toEqual({ descriptions: safe, warningIndices: [], maskedCount: 0 });
  });

  test("reviews the actual saved description, including empty-note fallback and resets", () => {
    for (const note of [undefined, "", " \t　", original]) {
      const value = getCsvImportDescription(original, note);
      expect(value).toBe(original);
      expect(reviewKotoraTransferDescriptions("smbc-bank", [value], false).warningIndices).toEqual([0]);
    }
    const edited = " 旅行代を精算 ";
    expect(getCsvImportDescription(original, edited)).toBe(edited);
    expect(reviewKotoraTransferDescriptions("smbc-bank", [edited], false).warningIndices).toEqual([]);
    expect(reviewKotoraTransferDescriptions("smbc-bank", ["ことら送金 タナカ (1234567890)"], false).warningIndices).toEqual([0]);
  });

  test("reviews only descriptions passed for the current import without merging rows", () => {
    expect(reviewKotoraTransferDescriptions("smbc-bank", [], false).warningIndices).toEqual([]);
    expect(reviewKotoraTransferDescriptions("smbc-bank", [original, original], false).warningIndices).toEqual([0, 1]);
    expect(reviewKotoraTransferDescriptions("smbc-bank", [original, "生活費", original], true).descriptions)
      .toEqual([masked, "生活費", masked]);
  });

  test("requires explicit opt-in to remember automatic masking", () => {
    for (const stored of [undefined, null, "", "false", '"true"', "garbled", "{}", "1"]) {
      expect(parseKotoraAutoMaskPreference(stored)).toBe(false);
    }
    expect(parseKotoraAutoMaskPreference("true")).toBe(true);
  });
});
