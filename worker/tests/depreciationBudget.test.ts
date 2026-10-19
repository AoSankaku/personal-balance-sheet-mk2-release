import { afterEach, describe, expect, test } from "bun:test";
import type { DepreciationBudgetSettings } from "../../shared/depreciationBudget";
import { depreciationRouter } from "../src/routes/depreciation";
import { createTestD1 } from "./helpers/d1";

function makeHarness() {
  const harness = createTestD1();
  const assetId = harness.sqlite
    .query(
      "INSERT INTO accounts (name, type, category) VALUES ('Laptop', 'asset', 'property') RETURNING id",
    )
    .get<{ id: number }>()!.id;
  const cashId = harness.sqlite
    .query(
      "INSERT INTO accounts (name, type, category) VALUES ('Cash', 'asset', 'cash') RETURNING id",
    )
    .get<{ id: number }>()!.id;
  const expenseId = harness.sqlite
    .query(
      "INSERT INTO accounts (name, type, category) VALUES ('Depreciation', 'expense', 'utilities') RETURNING id",
    )
    .get<{ id: number }>()!.id;
  const purchaseJournalId = harness.sqlite
    .query(
      "INSERT INTO journal_entries (date, description, created_at) VALUES ('2026-01-01', 'Laptop purchase', '2026-01-01 09:00:00') RETURNING id",
    )
    .get<{ id: number }>()!.id;
  harness.sqlite
    .query(
      "INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit, currency) VALUES (?, ?, 300000, 0, 'JPY'), (?, ?, 0, 300000, 'JPY')",
    )
    .run(purchaseJournalId, assetId, purchaseJournalId, cashId);
  const scheduleId = harness.sqlite
    .query(
      "INSERT INTO depreciation_schedules (source_journal_entry_id, asset_account_id, expense_account_id, total_amount, months, start_date, description) VALUES (?, ?, ?, 300000, 30, '2026-01-01', 'Laptop') RETURNING id",
    )
    .get<{ id: number }>(purchaseJournalId, assetId, expenseId)!.id;
  const purchaseCategoryId = harness.sqlite
    .query(
      "INSERT INTO budget_categories (name, budget_group) VALUES ('Laptop reserve', 'savings') RETURNING id",
    )
    .get<{ id: number }>()!.id;
  const sourceCategoryId = harness.sqlite
    .query(
      "INSERT INTO budget_categories (name, budget_group) VALUES ('Living costs', 'daily') RETURNING id",
    )
    .get<{ id: number }>()!.id;

  return {
    ...harness,
    env: { DB: harness.DB },
    scheduleId,
    assetId,
    expenseId,
    purchaseJournalId,
    purchaseCategoryId,
    sourceCategoryId,
  };
}

async function postJson(
  harness: ReturnType<typeof makeHarness>,
  path: string,
  body: unknown,
) {
  return depreciationRouter.request(
    path,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
    harness.env,
  );
}

describe("depreciation budget configuration and repair API", () => {
  const harnesses: ReturnType<typeof makeHarness>[] = [];
  afterEach(() => {
    for (const harness of harnesses.splice(0)) harness.close();
  });

  test("previews assigned, special, and unallocated purchase handling without changing journals", async () => {
    const harness = makeHarness();
    harnesses.push(harness);
    const journalCountBefore = harness.sqlite
      .query("SELECT COUNT(*) AS count FROM journal_entries")
      .get<{ count: number }>()!.count;

    const settings: DepreciationBudgetSettings[] = [
      {
        method: "assigned",
        purchase_category_id: harness.purchaseCategoryId,
        monthly_source_category_id: harness.sourceCategoryId,
      },
      { method: "special", monthly_source_category_id: harness.sourceCategoryId },
      { method: "unallocated", confirm_unallocated: true },
    ];

    for (const budgetSettings of settings) {
      const response = await postJson(
        harness,
        `/${harness.scheduleId}/budget/preview`,
        { settings: budgetSettings },
      );
      expect(response.status).toBe(200);
      const preview = (await response.json()) as {
        progress: { target_amount: number; method: string | null };
        changes: unknown[];
        can_apply: boolean;
      };
      expect(preview.progress).toMatchObject({
        target_amount: 300000,
        method: budgetSettings.method,
      });
      expect(Array.isArray(preview.changes)).toBe(true);
      expect(preview.can_apply).toBe(true);
    }

    expect(
      harness.sqlite
        .query("SELECT COUNT(*) AS count FROM journal_entries")
        .get<{ count: number }>()!.count,
    ).toBe(journalCountBefore);
  });

  test("requires explicit confirmation before applying an unallocated plan", async () => {
    const harness = makeHarness();
    harnesses.push(harness);
    const previewResponse = await postJson(
      harness,
      `/${harness.scheduleId}/budget/preview`,
      { settings: { method: "unallocated", confirm_unallocated: true } },
    );
    expect(previewResponse.status).toBe(200);
    const preview = (await previewResponse.json()) as {
      token: string;
      settings: DepreciationBudgetSettings;
    };

    const response = await postJson(harness, `/${harness.scheduleId}/budget/apply`, {
      token: preview.token,
      settings: preview.settings,
      confirmed: false,
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "confirmation_required" });
  });

  test("rejects a stale preview after source purchase data changes", async () => {
    const harness = makeHarness();
    harnesses.push(harness);
    const previewResponse = await postJson(
      harness,
      `/${harness.scheduleId}/budget/preview`,
      {
        settings: {
          method: "assigned",
          purchase_category_id: harness.purchaseCategoryId,
          monthly_source_category_id: harness.sourceCategoryId,
        },
      },
    );
    expect(previewResponse.status).toBe(200);
    const preview = (await previewResponse.json()) as {
      token: string;
      settings: DepreciationBudgetSettings;
    };
    harness.sqlite
      .query("UPDATE journal_lines SET debit = 290000 WHERE journal_entry_id = ? AND debit > 0")
      .run(harness.purchaseJournalId);

    const response = await postJson(harness, `/${harness.scheduleId}/budget/apply`, {
      token: preview.token,
      settings: preview.settings,
      confirmed: true,
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "stale_preview" });
  });

  test("lists unconfigured legacy schedules without assigning a method", async () => {
    const harness = makeHarness();
    harnesses.push(harness);
    const response = await depreciationRouter.request("/", {}, harness.env);
    expect(response.status).toBe(200);
    const schedules = (await response.json()) as { id: number; budget: { method: string | null; status: string } }[];
    expect(schedules).toContainEqual(
      expect.objectContaining({
        id: harness.scheduleId,
        budget: expect.objectContaining({ method: null, status: "unset" }),
      }),
    );
  });
});
