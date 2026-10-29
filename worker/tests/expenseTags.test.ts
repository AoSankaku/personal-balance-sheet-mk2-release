import { afterEach, beforeEach, expect, test } from "bun:test";
import app from "../src/index";
import { loadExpenseTagMetadata } from "../src/lib/expenseTags";
import { createTestD1 } from "./helpers/d1";
import { createIncomeBudgetScopeFixture } from "./helpers/incomeBudgetScopeFixture";

let fixture: ReturnType<typeof createIncomeBudgetScopeFixture>;
beforeEach(() => { fixture = createIncomeBudgetScopeFixture(); });
afterEach(() => fixture.close());

async function request(path: string, method = "GET", body?: unknown) {
  return app.request(`/api${path}`, {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, { DB: fixture.DB, DISABLE_ADMIN_API: "1" });
}

function entry(description: string, debit = 1200) {
  return {
    date: "2026-10-20", description, budget_source: "multiline",
    lines: [
      { account_id: 1006, debit, credit: 0, currency: "JPY" },
      { account_id: 1001, debit: 0, credit: debit, currency: "JPY" },
    ],
  };
}

test("creates reusable tags and derives automatic expense totals from expense lines only", async () => {
  const response = await request("/journal", "POST", {
    ...entry("Tagged expense", 1200), expense_tags: [" 2026年秋旅行 ", "食事", "2026年秋旅行"],
  });
  expect(response.status).toBe(201);
  const saved = await response.json() as any;
  expect(saved.expense_tags.map((tag: any) => tag.name)).toEqual(["2026年秋旅行", "食事"]);
  expect(saved.tag_expense_mode).toBe("auto");
  expect(saved.tag_expense_amounts).toEqual([{ currency: "JPY", amount: 1200 }]);

  const catalog = await request("/expense-tags");
  expect(await catalog.json()).toEqual(saved.expense_tags);
  const listed = await request("/journal");
  expect((await listed.json()).find((row: any) => row.id === saved.id).tag_expense_amounts)
    .toEqual([{ currency: "JPY", amount: 1200 }]);
});

test("automatic amounts include refunds and retain each represented currency separately", async () => {
  fixture.sqlite.exec("INSERT INTO enabled_currencies(code,decimal_places) VALUES('USD',2)");
  const yen = await request("/journal", "POST", {
    ...entry("Event yen", 1200), expense_tags: ["旅費"],
  });
  expect(yen.status).toBe(201);
  const usdRefund = await request("/journal", "POST", {
    date: "2026-10-21", description: "Event USD refund", budget_source: "multiline",
    expense_tags: ["旅費"],
    lines: [
      { account_id: 1001, debit: 0.25, credit: 0, currency: "USD" },
      { account_id: 1006, debit: 0, credit: 0.25, currency: "USD" },
    ],
  });
  expect(usdRefund.status).toBe(201);
  const yenSaved = await yen.json() as any;
  const refundSaved = await usdRefund.json() as any;
  expect(yenSaved.tag_expense_amounts).toEqual([{ currency: "JPY", amount: 1200 }]);
  expect(refundSaved.tag_expense_amounts).toEqual([{ currency: "USD", amount: -0.25 }]);
});

test("stores manual tag amounts, preserves omitted fields on edit, and clears on explicit empty tags", async () => {
  const created = await request("/journal", "POST", {
    ...entry("Manual event amount"), expense_tags: ["旅行"], tag_expense_mode: "manual",
    tag_expense_amounts: [{ currency: "JPY", amount: 400 }],
  });
  expect(created.status).toBe(201);
  const saved = await created.json() as any;
  expect(saved.tag_expense_mode).toBe("manual");
  expect(saved.tag_expense_amounts).toEqual([{ currency: "JPY", amount: 400 }]);

  const update = { ...entry("Edited description", 1000) };
  expect((await request(`/journal/${saved.id}`, "PUT", update)).status).toBe(200);
  const preserved = await (await request(`/journal/${saved.id}`)).json() as any;
  expect(preserved.expense_tags.map((tag: any) => tag.name)).toEqual(["旅行"]);
  expect(preserved.tag_expense_mode).toBe("manual");
  expect(preserved.tag_expense_amounts).toEqual([{ currency: "JPY", amount: 400 }]);

  expect((await request(`/journal/${saved.id}`, "PUT", {
    ...update, expense_tags: [],
  })).status).toBe(200);
  const cleared = await (await request(`/journal/${saved.id}`)).json() as any;
  expect(cleared.expense_tags).toEqual([]);
  expect(cleared.tag_expense_mode).toBe("auto");
  expect(cleared.tag_expense_amounts).toEqual([{ currency: "JPY", amount: 1000 }]);
});

test("switching a tagged entry explicitly back to automatic clears manual overrides", async () => {
  const created = await request("/journal", "POST", {
    ...entry("Manual then automatic"), expense_tags: ["旅行"], tag_expense_mode: "manual",
    tag_expense_amounts: [{ currency: "JPY", amount: 400 }],
  });
  const saved = await created.json() as any;
  expect((await request(`/journal/${saved.id}`, "PUT", {
    ...entry("Automatic again"), expense_tags: ["旅行"], tag_expense_mode: "auto",
  })).status).toBe(200);
  const result = await (await request(`/journal/${saved.id}`)).json() as any;
  expect(result.tag_expense_mode).toBe("auto");
  expect(result.tag_expense_amounts).toEqual([{ currency: "JPY", amount: 1200 }]);
});

test("recomputes automatic totals after editing and keeps prior tags and overrides in edit history", async () => {
  const created = await request("/journal", "POST", {
    ...entry("Auto tag"), expense_tags: ["イベント"],
  });
  const saved = await created.json() as any;
  expect((await request(`/journal/${saved.id}`, "PUT", entry("Edited auto tag", 700))).status).toBe(200);
  const current = await (await request(`/journal/${saved.id}`)).json() as any;
  expect(current.tag_expense_amounts).toEqual([{ currency: "JPY", amount: 700 }]);
  const history = await (await request("/journal-history")).json() as any;
  expect(history.entries[0].entry).toMatchObject({
    expense_tags: [{ name: "イベント" }], tag_expense_mode: "auto",
  });

  const manual = await request("/journal", "POST", {
    ...entry("Manual tag"), expense_tags: ["手動"], tag_expense_mode: "manual",
    tag_expense_amounts: [{ currency: "JPY", amount: 333 }],
  });
  const manualSaved = await manual.json() as any;
  expect((await request(`/journal/${manualSaved.id}`, "PUT", entry("Edited manual", 800))).status).toBe(200);
  const updatedHistory = await (await request("/journal-history")).json() as any;
  const archived = updatedHistory.entries.find((row: any) => row.original_journal_entry_id === manualSaved.id);
  expect(archived.entry).toMatchObject({
    expense_tags: [{ name: "手動" }], tag_expense_mode: "manual",
    tag_expense_amounts: [{ currency: "JPY", amount: 333 }],
  });
});

test("rejects manual totals on simple entries and invalid tags or amounts without partial writes", async () => {
  const simple = await request("/journal", "POST", {
    ...entry("Simple manual"), budget_source: "simple", expense_tags: ["不正"],
    tag_expense_mode: "manual", tag_expense_amounts: [{ currency: "JPY", amount: 1 }],
  });
  expect(simple.status).toBe(400);

  for (const expense_tags of [[""], [" x ".repeat(30)], [1], Array.from({ length: 21 }, (_, index) => `tag-${index}`)]) {
    expect((await request("/journal", "POST", { ...entry("Invalid tag"), expense_tags })).status).toBe(400);
  }
  expect((await request("/journal", "POST", {
    ...entry("Invalid amount"), expense_tags: ["不正"], tag_expense_mode: "manual",
    tag_expense_amounts: [{ currency: "JPY", amount: 1.5 }],
  })).status).toBe(400);
  expect((await request("/expense-tags")).status).toBe(200);
  expect(await (await request("/expense-tags")).json()).toEqual([]);
});

test("validates an entire batch before creating any journal or reusable tag rows", async () => {
  const response = await request("/journal/batch", "POST", { entries: [
    { ...entry("Valid batch"), expense_tags: ["batch-tag"] },
    { ...entry("Invalid batch"), expense_tags: ["bad"], tag_expense_mode: "manual", tag_expense_amounts: [{ currency: "NOPE", amount: 1 }] },
  ] });
  expect(response.status).toBe(400);
  expect(fixture.sqlite.query("SELECT COUNT(*) AS count FROM journal_entries").get()).toEqual({ count: 1 });
  expect(await (await request("/expense-tags")).json()).toEqual([]);
});

test("metadata-only tag edits are allowed for protected depreciation entries and archive atomically", async () => {
  fixture.sqlite.exec(`
    INSERT INTO journal_entries(id,date,description) VALUES(9300,'2026-10-20','Managed purchase');
    INSERT INTO journal_lines(journal_entry_id,account_id,debit,credit,currency) VALUES
      (9300,1006,500,0,'JPY'),(9300,1001,0,500,'JPY');
    INSERT INTO depreciation_schedules(source_journal_entry_id,asset_account_id,expense_account_id,total_amount,months,start_date,description,budget_method)
      VALUES(9300,1001,1006,500,1,'2026-10-20','managed','assigned');
  `);
  expect((await request("/journal/9300/expense-tags", "PATCH", { expense_tags: [""] })).status).toBe(400);
  expect(await (await request("/journal-history")).json()).toMatchObject({ total: 0 });
  const saved = await request("/journal/9300/expense-tags", "PATCH", { expense_tags: ["減価償却対象"] });
  expect(saved.status).toBe(200);
  expect(await saved.json()).toMatchObject({
    expense_tags: [{ name: "減価償却対象" }], tag_expense_mode: "auto",
    tag_expense_amounts: [{ currency: "JPY", amount: 500 }],
  });
  const history = await (await request("/journal-history")).json() as any;
  expect(history.total).toBe(1);
  expect(history.entries[0].entry.expense_tags).toEqual([]);
  expect((await request("/journal/9300", "PUT", entry("blocked edit", 300))).status).toBe(409);
  expect((await request("/journal/9300")).status).toBe(200);
});

test("metadata-only tag edits preserve manual amounts until tags are explicitly cleared", async () => {
  fixture.sqlite.exec(`
    INSERT INTO journal_entries(id,date,description) VALUES(9310,'2026-10-20','Tagged protected purchase');
    INSERT INTO journal_lines(journal_entry_id,account_id,debit,credit,currency) VALUES
      (9310,1006,500,0,'JPY'),(9310,1001,0,500,'JPY');
    INSERT INTO expense_tags(name) VALUES('既存タグ');
    INSERT INTO journal_entry_expense_tags(journal_entry_id,tag_id) VALUES(9310,(SELECT id FROM expense_tags WHERE name='既存タグ'));
    INSERT INTO journal_entry_tag_amounts(journal_entry_id,currency,amount) VALUES(9310,'JPY',300);
  `);
  const updated = await request("/journal/9310/expense-tags", "PATCH", { expense_tags: ["新しいタグ"] });
  expect(await updated.json()).toMatchObject({
    expense_tags: [{ name: "新しいタグ" }], tag_expense_mode: "manual",
    tag_expense_amounts: [{ currency: "JPY", amount: 300 }],
  });
  const cleared = await request("/journal/9310/expense-tags", "PATCH", { expense_tags: [] });
  expect(await cleared.json()).toMatchObject({
    expense_tags: [], tag_expense_mode: "auto",
    tag_expense_amounts: [{ currency: "JPY", amount: 500 }],
  });
  const history = await (await request("/journal-history")).json() as any;
  expect(history.entries[1].entry).toMatchObject({
    expense_tags: [{ name: "既存タグ" }], tag_expense_mode: "manual",
    tag_expense_amounts: [{ currency: "JPY", amount: 300 }],
  });
});

test("loads metadata for 200 entries in three bounded-parameter queries", async () => {
  const largeFixture = createTestD1({ maxParameters: 100 });
  try {
    const { sqlite, DB } = largeFixture;
    sqlite.exec("INSERT INTO accounts (name, type, category) VALUES ('Expense', 'expense', 'food')");
    sqlite.exec("INSERT INTO expense_tags (name) VALUES ('Event')");
    const accountId = Number((sqlite.query("SELECT id FROM accounts WHERE name='Expense'").get() as { id: number }).id);
    const tagId = Number((sqlite.query("SELECT id FROM expense_tags WHERE name='Event'").get() as { id: number }).id);
    const entryValues = Array.from({ length: 200 }, (_, index) =>
      `('2026-10-20', 'Entry ${index + 1}')`).join(",");
    sqlite.exec(`INSERT INTO journal_entries (date, description) VALUES ${entryValues}`);
    const entryIds = (sqlite.query("SELECT id FROM journal_entries ORDER BY id").all() as { id: number }[])
      .map(({ id }) => id);
    const lineValues = entryIds.map((id) => `(${id}, ${accountId}, 75, 0, 'JPY')`).join(",");
    sqlite.exec(`INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit, currency) VALUES ${lineValues}`);
    const tagValues = entryIds.map((id) => `(${id}, ${tagId})`).join(",");
    sqlite.exec(`INSERT INTO journal_entry_expense_tags (journal_entry_id, tag_id) VALUES ${tagValues}`);

    let preparedReads = 0;
    const countingDb = {
      ...DB,
      prepare(query: string) {
        if (query.includes("FROM json_each(?)")) preparedReads += 1;
        return DB.prepare(query);
      },
    } as D1Database;
    const metadata = await loadExpenseTagMetadata(
      countingDb,
      entryIds,
      { JPY: 0 },
    );

    expect(preparedReads).toBe(3);
    expect(metadata.size).toBe(200);
    for (const record of metadata.values()) {
      expect(record.expense_tags).toEqual([{ id: tagId, name: "Event" }]);
      expect(record.tag_expense_mode).toBe("auto");
      expect(record.tag_expense_amounts).toEqual([{ currency: "JPY", amount: 75 }]);
    }
  } finally {
    largeFixture.close();
  }
});
