import { afterEach, expect, test } from "bun:test";
import { depreciationRouter } from "../src/routes/depreciation";
import { budgetRouter } from "../src/routes/budget";
import { createTestD1 } from "./helpers/d1";

const databases: ReturnType<typeof createTestD1>[] = [];
afterEach(() => { for (const database of databases.splice(0)) database.close(); });

const legacySettings = {
  method: "assigned" as const,
  purchase_category_id: 1001,
  monthly_source_category_id: 1002,
  monthly_source_allocations: [
    { budget_category_id: 1002, ratio: 45 },
    { budget_category_id: 1003, ratio: 55 },
  ],
};

function fixture() {
  const database = createTestD1();
  databases.push(database);
  database.sqlite.exec(`
    INSERT INTO accounts(id,name,type,category,is_depreciable) VALUES
      (1001,'Bank','asset','cash',0),
      (1002,'Mattress','asset','property',1),
      (1003,'Household maintenance','expense','other',0);
    INSERT INTO budget_categories(id,name) VALUES
      (1001,'Purchase reserve'), (1002,'Monthly source A'), (1003,'Monthly source B');
    INSERT INTO budget_category_accounts(budget_category_id,account_id,ratio) VALUES
      (1002,1003,45), (1003,1003,55);
    INSERT INTO journal_entries(id,date,description,created_at,source) VALUES
      (7000,'2026-01-15','Mattress purchase','2026-01-15 09:00:00',NULL),
      (7101,'2026-01-15','Mattress 1/2','2026-01-15 09:01:00',NULL),
      (7102,'2026-02-01','Mattress 2/2','2026-02-01 09:01:00',NULL);
    INSERT INTO journal_lines(journal_entry_id,account_id,debit,credit,currency,created_at) VALUES
      (7000,1002,5616,0,'JPY','2026-01-15 09:00:00'),
      (7000,1001,0,5616,'JPY','2026-01-15 09:00:00'),
      (7101,1003,368,0,'JPY','2026-01-15 09:01:00'),
      (7101,1002,0,368,'JPY','2026-01-15 09:01:00'),
      (7102,1003,5248,0,'JPY','2026-02-01 09:01:00'),
      (7102,1002,0,5248,'JPY','2026-02-01 09:01:00');
    INSERT INTO depreciation_schedules(id,source_journal_entry_id,asset_account_id,expense_account_id,total_amount,months,start_date,description)
      VALUES (100,7000,1002,1003,5616,2,'2026-01-15','Mattress');
    INSERT INTO depreciation_entries(schedule_id,journal_entry_id,month_number) VALUES
      (100,7101,1),(100,7102,2);
    INSERT INTO journal_entry_budget_allocations(journal_entry_id,budget_category_id,amount,currency,source,is_reference,created_at) VALUES
      (7101,1002,-166,'JPY',NULL,0,'2026-01-15 09:01:00'),
      (7101,1003,-202,'JPY',NULL,0,'2026-01-15 09:01:00'),
      (7102,1002,-2362,'JPY',NULL,0,'2026-02-01 09:01:00'),
      (7102,1003,-2886,'JPY',NULL,0,'2026-02-01 09:01:00');
  `);
  return database;
}

function post(database: ReturnType<typeof fixture>, path: string, body: unknown) {
  return depreciationRouter.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }, { DB: database.DB });
}

async function availableAt(database: ReturnType<typeof fixture>, categoryId: number) {
  const response = await budgetRouter.request(
    "/summary?year_month=2026-03&as_of=2026-03-01",
    {},
    { DB: database.DB },
  );
  expect(response.status).toBe(200);
  const summary = await response.json() as { categories: { category: { id: number }; available: number }[] };
  return summary.categories.find((row) => row.category.id === categoryId)!.available;
}

test("repairs a canonical legacy monthly allocation bundle without double charging or changing journal lines", async () => {
  const database = fixture();
  const journalLinesBefore = database.sqlite.query(`SELECT id,journal_entry_id,account_id,debit,credit,currency,created_at
    FROM journal_lines WHERE journal_entry_id IN (7000,7101,7102) ORDER BY id`).all();
  const sourceBudgetBefore = await availableAt(database, 1002);
  const secondSourceBudgetBefore = await availableAt(database, 1003);
  const purchaseBudgetBefore = await availableAt(database, 1001);

  const previewResponse = await post(database, "/100/budget/preview", { settings: legacySettings });
  expect(previewResponse.status).toBe(200);
  const preview = await previewResponse.json() as {
    token: string;
    settings: typeof legacySettings;
    can_apply: boolean;
    warnings: string[];
  };
  expect(preview.can_apply).toBe(true);
  expect(preview.warnings).not.toContain("ambiguous_legacy_allocations");

  const applyResponse = await post(database, "/100/budget/apply", {
    token: preview.token,
    settings: preview.settings,
    confirmed: true,
  });
  expect(applyResponse.status).toBe(200);

  expect(database.sqlite.query("SELECT COUNT(*) AS count FROM journal_entry_budget_allocations WHERE journal_entry_id IN (7101,7102)")
    .get()).toEqual({ count: 0 });
  expect(database.sqlite.query(`SELECT COUNT(*) AS count FROM budget_adjustment_logs
    WHERE depreciation_schedule_id=100 AND depreciation_event_key LIKE 'monthly:%'
      AND depreciation_event_side='source' AND amount<0`).get()).toEqual({ count: 4 });
  expect(database.sqlite.query(`SELECT SUM(amount) AS amount FROM budget_adjustment_logs
    WHERE depreciation_schedule_id=100 AND depreciation_event_key LIKE 'monthly:%'
      AND depreciation_event_side='source'`).get()).toEqual({ amount: -5616 });
  expect(await availableAt(database, 1002)).toBe(sourceBudgetBefore);
  expect(await availableAt(database, 1003)).toBe(secondSourceBudgetBefore);
  expect(await availableAt(database, 1001)).toBe(purchaseBudgetBefore);
  expect(database.sqlite.query(`SELECT id,journal_entry_id,account_id,debit,credit,currency,created_at
    FROM journal_lines WHERE journal_entry_id IN (7000,7101,7102) ORDER BY id`).all()).toEqual(journalLinesBefore);

  const audit = database.sqlite.query(`SELECT before_events FROM depreciation_budget_revisions
    WHERE schedule_id=100 AND action='apply'`).get() as { before_events: string };
  const beforeEvents = JSON.parse(audit.before_events) as {
    legacy_allocations: { journal_entry_id: number; amount: number; source: string | null }[];
  };
  expect(beforeEvents.legacy_allocations).toHaveLength(4);
  expect(beforeEvents.legacy_allocations.map((row) => [row.journal_entry_id, row.amount, row.source])).toEqual([
    [7101, -166, null],
    [7101, -202, null],
    [7102, -2362, null],
    [7102, -2886, null],
  ]);
});

test.each([
  "journal-source",
  "edited-line-timestamp",
  "allocation-timestamp",
  "allocation-total",
  "unsafe-allocation-amount",
  "unsafe-allocation-total",
  "reference-allocation",
  "wrong-allocation-currency",
  "wrong-line-currency",
  "duplicate-category",
  "mixed-source",
  "positive-allocation",
  "missing-allocation",
  "duplicate-month",
  "wrong-month-date",
  "wrong-line-account",
  "extra-journal-line",
  "shared-monthly-entry",
  "monthly-is-other-purchase",
  "configured-plan",
  "method-without-settings",
  "settings-without-method",
  "purchase-allocation",
])("leaves ambiguous legacy allocation data untouched (%s)", async (caseName) => {
  const database = fixture();
  if (caseName === "journal-source") {
    database.sqlite.query("UPDATE journal_entries SET source='manual' WHERE id=7101").run();
  } else if (caseName === "edited-line-timestamp") {
    database.sqlite.query("UPDATE journal_lines SET created_at='2026-01-15 09:02:00' WHERE journal_entry_id=7101 AND account_id=1003").run();
  } else if (caseName === "allocation-timestamp") {
    database.sqlite.query("UPDATE journal_entry_budget_allocations SET created_at='2026-01-15 09:02:00' WHERE journal_entry_id=7101 AND budget_category_id=1002").run();
  } else if (caseName === "allocation-total") {
    database.sqlite.query("UPDATE journal_entry_budget_allocations SET amount=-165 WHERE journal_entry_id=7101 AND budget_category_id=1002").run();
  } else if (caseName === "unsafe-allocation-amount") {
    database.sqlite.query("UPDATE journal_entry_budget_allocations SET amount=-9007199254740992 WHERE journal_entry_id=7101 AND budget_category_id=1002").run();
  } else if (caseName === "unsafe-allocation-total") {
    database.sqlite.query("UPDATE journal_entry_budget_allocations SET amount=-9007199254740000 WHERE journal_entry_id=7101 AND budget_category_id=1002").run();
    database.sqlite.query("UPDATE journal_entry_budget_allocations SET amount=-2000 WHERE journal_entry_id=7101 AND budget_category_id=1003").run();
  } else if (caseName === "reference-allocation") {
    database.sqlite.query("UPDATE journal_entry_budget_allocations SET is_reference=1 WHERE journal_entry_id=7101 AND budget_category_id=1002").run();
  } else if (caseName === "wrong-allocation-currency") {
    database.sqlite.query("UPDATE journal_entry_budget_allocations SET currency='USD' WHERE journal_entry_id=7101").run();
  } else if (caseName === "wrong-line-currency") {
    database.sqlite.query("UPDATE journal_lines SET currency='USD' WHERE journal_entry_id=7101").run();
  } else if (caseName === "duplicate-category") {
    database.sqlite.query("UPDATE journal_entry_budget_allocations SET budget_category_id=1002 WHERE journal_entry_id=7101 AND budget_category_id=1003").run();
  } else if (caseName === "mixed-source") {
    database.sqlite.query("UPDATE journal_entry_budget_allocations SET source='depreciation' WHERE journal_entry_id=7101 AND budget_category_id=1002").run();
  } else if (caseName === "positive-allocation") {
    database.sqlite.query("UPDATE journal_entry_budget_allocations SET amount=10 WHERE journal_entry_id=7101 AND budget_category_id=1003").run();
    database.sqlite.query("UPDATE journal_entry_budget_allocations SET amount=-378 WHERE journal_entry_id=7101 AND budget_category_id=1002").run();
  } else if (caseName === "missing-allocation") {
    database.sqlite.query("DELETE FROM journal_entry_budget_allocations WHERE journal_entry_id=7101 AND budget_category_id=1003").run();
  } else if (caseName === "duplicate-month") {
    database.sqlite.query("UPDATE depreciation_entries SET month_number=1 WHERE schedule_id=100 AND journal_entry_id=7102").run();
    database.sqlite.query("UPDATE journal_entries SET date='2026-01-15' WHERE id=7102").run();
  } else if (caseName === "wrong-month-date") {
    database.sqlite.query("UPDATE journal_entries SET date='2026-02-02' WHERE id=7102").run();
  } else if (caseName === "wrong-line-account") {
    database.sqlite.query("INSERT INTO accounts(id,name,type,category) VALUES(1004,'Other asset','asset','property')").run();
    database.sqlite.query("UPDATE journal_lines SET account_id=1004 WHERE journal_entry_id=7101 AND credit>0").run();
  } else if (caseName === "extra-journal-line") {
    database.sqlite.query(`INSERT INTO journal_lines(journal_entry_id,account_id,debit,credit,currency,created_at)
      VALUES(7101,1003,0,0,'JPY','2026-01-15 09:01:00')`).run();
  } else if (caseName === "shared-monthly-entry") {
    database.sqlite.exec(`INSERT INTO depreciation_schedules(id,source_journal_entry_id,asset_account_id,expense_account_id,total_amount,months,start_date,description)
      VALUES (101,7000,1002,1003,5616,2,'2026-01-15','Other plan');
      INSERT INTO depreciation_entries(schedule_id,journal_entry_id,month_number) VALUES (101,7101,1);`);
  } else if (caseName === "monthly-is-other-purchase") {
    database.sqlite.query(`INSERT INTO depreciation_schedules(id,source_journal_entry_id,asset_account_id,expense_account_id,total_amount,months,start_date,description)
      VALUES (101,7101,1002,1003,368,1,'2026-01-15','Other purchase');`).run();
  } else if (caseName === "configured-plan") {
    database.sqlite.query("UPDATE depreciation_schedules SET budget_method='assigned',budget_settings=? WHERE id=100")
      .run(JSON.stringify(legacySettings));
  } else if (caseName === "method-without-settings") {
    database.sqlite.query("UPDATE depreciation_schedules SET budget_method='assigned' WHERE id=100").run();
  } else if (caseName === "settings-without-method") {
    database.sqlite.query("UPDATE depreciation_schedules SET budget_settings=? WHERE id=100")
      .run(JSON.stringify(legacySettings));
  } else {
    database.sqlite.query(`INSERT INTO journal_entry_budget_allocations(journal_entry_id,budget_category_id,amount,currency,source,is_reference,created_at)
      VALUES(7000,1001,-5616,'JPY',NULL,0,'2026-01-15 09:00:00')`).run();
  }
  const rowsBefore = database.sqlite.query(`SELECT id,journal_entry_id,budget_category_id,amount,currency,source,is_reference,created_at
    FROM journal_entry_budget_allocations ORDER BY id`).all();

  const previewResponse = await post(database, "/100/budget/preview", { settings: legacySettings });
  if (caseName === "duplicate-month") {
    expect(previewResponse.status).toBe(400);
    expect(await previewResponse.json()).toMatchObject({ error: "ambiguous_depreciation_months" });
    expect(database.sqlite.query(`SELECT id,journal_entry_id,budget_category_id,amount,currency,source,is_reference,created_at
      FROM journal_entry_budget_allocations ORDER BY id`).all()).toEqual(rowsBefore);
    return;
  }
  expect(previewResponse.status).toBe(200);
  const preview = await previewResponse.json() as {
    token: string;
    settings: typeof legacySettings;
    can_apply: boolean;
    warnings: string[];
  };
  expect(preview.can_apply).toBe(false);
  expect(preview.warnings).toContain("ambiguous_legacy_allocations");
  const applyResponse = await post(database, "/100/budget/apply", {
    token: preview.token,
    settings: preview.settings,
    confirmed: true,
  });
  expect(applyResponse.status).toBe(409);
  expect(database.sqlite.query(`SELECT id,journal_entry_id,budget_category_id,amount,currency,source,is_reference,created_at
    FROM journal_entry_budget_allocations ORDER BY id`).all()).toEqual(rowsBefore);
});
