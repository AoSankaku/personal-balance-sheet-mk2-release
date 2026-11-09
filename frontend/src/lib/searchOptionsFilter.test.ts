import { describe, expect, test } from "bun:test";
import { defaultOptionsFilter, type ComboboxParsedItem } from "@mantine/core";
import { appTheme } from "../theme";
import { searchOptionsFilter } from "./searchOptionsFilter";

describe("searchable option filtering", () => {
  const half = { value: "half-id", label: "ｻﾝﾌﾟﾙ銀行", disabled: true, icon: "bank" };
  const full = { value: "full-id", label: "サンプルカード" };
  const unrelated = { value: "other-id", label: "別口座" };
  const options = [half, full, unrelated];

  test.each(["サンプル", "ｻﾝﾌﾟﾙ", " サンプル "])("finds both widths with %s without changing labels, values, or metadata", (search) => {
    const before = structuredClone(options);
    const filtered = searchOptionsFilter({ options, search, limit: Infinity });
    expect(filtered).toEqual([half, full]);
    expect(filtered[0]).toBe(half);
    expect(filtered[1]).toBe(full);
    expect(options).toEqual(before);
  });

  test("handles grouped account options and retains the group label", () => {
    const grouped = [{ group: "銀行", items: [half, unrelated] }, { group: "カード", items: [full] }];
    expect(searchOptionsFilter({ options: grouped, search: "ｻﾝﾌﾟﾙ", limit: Infinity })).toEqual([
      { group: "銀行", items: [half] },
      { group: "カード", items: [full] },
    ]);
  });

  test("does not match option values or group labels", () => {
    expect(searchOptionsFilter({ options, search: "half-id", limit: Infinity })).toEqual([]);
    expect(searchOptionsFilter({ options: [{ group: "サンプル", items: [unrelated] }], search: "ｻﾝﾌﾟﾙ", limit: Infinity })).toEqual([
      { group: "サンプル", items: [] },
    ]);
  });

  test("preserves the default filter's ordering and limits for ordinary searches", () => {
    const ordinary: ComboboxParsedItem[] = [
      { value: "a", label: "Alpha Bank" },
      { group: "Banks", items: [{ value: "b", label: "Beta Bank" }, { value: "c", label: "Gamma Bank" }] },
      { value: "d", label: "Other" },
    ];
    for (const search of ["", " bank ", "other", "absent"]) {
      for (const limit of [0, 1, 2, Infinity]) {
        const input = { options: ordinary, search, limit };
        expect(searchOptionsFilter(input)).toEqual(defaultOptionsFilter(input));
      }
    }
  });

  test("applies the shared filter to all built-in searchable selection controls", () => {
    for (const name of ["Select", "MultiSelect", "Autocomplete", "TagsInput"]) {
      expect(appTheme.components?.[name].defaultProps?.filter).toBe(searchOptionsFilter);
    }
    expect(appTheme.cursorType).toBe("pointer");
  });
});
