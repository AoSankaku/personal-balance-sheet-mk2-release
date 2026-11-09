import { describe, expect, test } from "bun:test";
import { includesSearchText, normalizeSearchText } from "./searchText";

describe("kana width insensitive search", () => {
  test.each([
    ["カタカナ", "ｶﾀｶﾅ"],
    ["ガギグゲゴ", "ｶﾞｷﾞｸﾞｹﾞｺﾞ"],
    ["パピプペポ", "ﾊﾟﾋﾟﾌﾟﾍﾟﾎﾟ"],
    ["ヴァイオリン", "ｳﾞｧｲｵﾘﾝ"],
    ["スーパー", "ｽｰﾊﾟｰ"],
    ["キャッシュ", "ｷｬｯｼｭ"],
    ["カ\u3099", "ｶﾞ"],
    ["ガ", "カﾞ"],
    ["モバイル Wallet", "ﾓﾊﾞｲﾙ wallet"],
  ])("matches %s and %s in either direction", (full, half) => {
    expect(normalizeSearchText(full)).toBe(normalizeSearchText(half));
    expect(includesSearchText(`決済 ${full} 店`, half)).toBe(true);
    expect(includesSearchText(`決済 ${half} 店`, full)).toBe(true);
  });

  test("retains case-insensitive substring and empty-query behavior", () => {
    expect(includesSearchText("Example BANK", "bank")).toBe(true);
    expect(includesSearchText("決済サンプル店舗", "ｻﾝﾌﾟﾙ")).toBe(true);
    expect(includesSearchText("anything", "")).toBe(true);
    expect(includesSearchText("", "カナ")).toBe(false);
    expect(includesSearchText("別の店舗", "サンプル")).toBe(false);
  });

  test("preserves distinctions beyond kana width and does not discard spaces", () => {
    expect(includesSearchText("カ", "ガ")).toBe(false);
    expect(includesSearchText("ハ", "パ")).toBe(false);
    expect(includesSearchText("かたかな", "カタカナ")).toBe(false);
    expect(includesSearchText("Ⅳ", "IV")).toBe(false);
    expect(includesSearchText("①", "1")).toBe(false);
    expect(includesSearchText("sample", " sample ")).toBe(false);
  });
});
