import { describe, expect, it } from "bun:test";

import { getIncomeDescriptionForSubmit } from "../src/lib/simpleEntryUtils";

describe("getIncomeDescriptionForSubmit", () => {
  it("uses the salary account name when a salary income entry has no description", () => {
    expect(
      getIncomeDescriptionForSubmit("", {
        id: 1,
        name: "給与",
        type: "income",
        category: "salary",
        created_at: "2026-05-01T00:00:00.000Z",
      }),
    ).toBe("給与");
  });

  it("keeps a manually entered description", () => {
    expect(
      getIncomeDescriptionForSubmit("4月分 給与", {
        id: 1,
        name: "給与",
        type: "income",
        category: "salary",
        created_at: "2026-05-01T00:00:00.000Z",
      }),
    ).toBe("4月分 給与");
  });

  it("does not fill non-salary income descriptions", () => {
    expect(
      getIncomeDescriptionForSubmit("", {
        id: 2,
        name: "利息",
        type: "income",
        category: "other",
        created_at: "2026-05-01T00:00:00.000Z",
      }),
    ).toBe("");
  });
});
