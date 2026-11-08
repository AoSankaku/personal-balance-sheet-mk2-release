import { afterEach, expect, test } from "bun:test";
import { IMPORT_TABLE_ORDER } from "../scripts/sync-local-d1-to-remote.mjs";
import { journalRouter } from "../src/routes/journal";
import { loansRouter } from "../src/routes/loans";
import { createTestD1 } from "./helpers/d1";
import { createLoanManagementBudgetFixture } from "./helpers/loanManagementBudgetFixture";

const fixtures: ReturnType<typeof createLoanManagementBudgetFixture>[] = [];
type TestDatabaseBinding = ReturnType<typeof createTestD1>["DB"];
afterEach(() => { for (const fixture of fixtures.splice(0)) fixture.close(); });

function fixture() {
  const value = createLoanManagementBudgetFixture();
  fixtures.push(value);
  return value;
}

function request(
  value: ReturnType<typeof createLoanManagementBudgetFixture>,
  accountId: number,
  method = "GET",
  body?: unknown,
  currency = "JPY",
  db: TestDatabaseBinding = value.DB,
) {
  return loansRouter.request(`/${accountId}/budget-defaults?currency=${currency}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }, { DB: db });
}

test("borrowing and lending defaults inherit the earliest opening split per currency", async () => {
  const value = fixture();
  for (const [accountId, sourceEntryId] of [[1010, 9001], [1011, 9002]] as const) {
    const response = await request(value, accountId);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      account_id: accountId,
      currency: "JPY",
      source: "opening",
      source_journal_entry_id: sourceEntryId,
      allocations: [{ budget_category_id: 1001, weight: 1 }],
      settled_minor_units: 1000,
      settled_allocations: [{ budget_category_id: 1001, minor_units: 1000 }],
      settled_progress_available: true,
    });
  }

  const usd = await request(value, 1010, "GET", undefined, "USD");
  expect(usd.status).toBe(200);
  expect(await usd.json()).toMatchObject({ currency: "USD", source_journal_entry_id: 9101 });
});

test("uses the chronological first opening and does not fall through when its split is missing", async () => {
  const value = fixture();
  value.sqlite.exec(`
    INSERT INTO journal_entries(id,date,description,created_at) VALUES(9010,'2026-11-10','後日の貸付','2026-11-10 00:00:00');
    INSERT INTO journal_lines(journal_entry_id,account_id,debit,credit,currency) VALUES
      (9010,1010,500,0,'JPY'),(9010,1001,0,500,'JPY');
    INSERT INTO budget_funding_allocations(journal_entry_id,budget_category_id,kind,amount,currency,effect)
      VALUES(9010,1002,'lend',500,'JPY','apply');
  `);

  const firstOpening = await request(value, 1010);
  expect(firstOpening.status).toBe(200);
  expect(await firstOpening.json()).toMatchObject({
    source_journal_entry_id: 9001,
    allocations: [{ budget_category_id: 1001, weight: 1 }],
  });

  value.sqlite.exec("DELETE FROM budget_funding_allocations WHERE journal_entry_id=9001");
  const missingFirstSplit = await request(value, 1010);
  expect(missingFirstSplit.status).toBe(200);
  expect(await missingFirstSplit.json()).toMatchObject({
    account_id: 1010,
    currency: "JPY",
    source: "unavailable",
    source_journal_entry_id: 9001,
    allocations: [{ budget_category_id: null, weight: 1 }],
    settled_minor_units: 0,
    settled_allocations: [],
    settled_progress_available: true,
  });
});

test("keeps only categories actually changed and assigns component-only and missing principal to unallocated", async () => {
  const value = fixture();
  value.sqlite.exec(`
    DELETE FROM budget_funding_allocations WHERE journal_entry_id=9001;
    INSERT INTO budget_funding_allocations(journal_entry_id,budget_category_id,kind,amount,currency,effect) VALUES
      (9001,1001,'lend',30000,'JPY','apply'),
      (9001,1002,'lend',20000,'JPY','component_only');
  `);

  const response = await request(value, 1010);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    source: "opening",
    allocations: [
      { budget_category_id: 1001, weight: 3 },
      { budget_category_id: null, weight: 7 },
    ],
  });
});

test("preserves minor-unit source ratios and a one-unit remainder exactly", async () => {
  const value = fixture();
  value.sqlite.exec(`
    DELETE FROM budget_funding_allocations WHERE journal_entry_id=9101;
    INSERT INTO budget_funding_allocations(journal_entry_id,budget_category_id,kind,amount,currency,effect) VALUES
      (9101,1001,'lend',33333,'USD','apply'),
      (9101,1002,'lend',66666,'USD','apply');
  `);

  const response = await request(value, 1010, "GET", undefined, "USD");
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    currency: "USD",
    source_journal_entry_id: 9101,
    allocations: [
      { budget_category_id: 1001, weight: 33333 },
      { budget_category_id: 1002, weight: 66666 },
      { budget_category_id: null, weight: 1 },
    ],
  });
});

test("an opening touching multiple lending accounts has no safely attributable inherited split", async () => {
  const value = fixture();
  value.sqlite.exec(`
    UPDATE journal_lines SET credit=101000 WHERE journal_entry_id=9001 AND account_id=1001;
    INSERT INTO journal_lines(journal_entry_id,account_id,debit,credit,currency)
      VALUES(9001,1012,1000,0,'JPY');
  `);

  const response = await request(value, 1010);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    account_id: 1010,
    currency: "JPY",
    source: "unavailable",
    source_journal_entry_id: 9001,
    allocations: [{ budget_category_id: null, weight: 1 }],
    settled_minor_units: 0,
    settled_allocations: [],
    settled_progress_available: true,
  });
});

test("reads each inherited split and settlement snapshot in one combined D1 query", async () => {
  const value = fixture();
  const relevantReads: string[] = [];
  const countedDb = {
    prepare(query: string) {
      if (query.includes("journal_lines") || query.includes("budget_funding_allocations")) {
        relevantReads.push(query);
      }
      return value.DB.prepare(query);
    },
  } as TestDatabaseBinding;

  const response = await request(value, 1010, "GET", undefined, "JPY", countedDb);
  expect(response.status).toBe(200);
  expect(relevantReads).toHaveLength(2);
  expect(relevantReads.every((query) =>
    query.includes("journal_lines") && query.includes("budget_funding_allocations"),
  )).toBe(true);
});

test("replays tied repayments in journal ID order and preserves carry across backdated entries", async () => {
  const value = fixture();
  value.sqlite.exec(`
    UPDATE journal_lines SET debit=2 WHERE journal_entry_id=9001 AND account_id=1010;
    UPDATE journal_lines SET credit=2 WHERE journal_entry_id=9001 AND account_id=1001;
    DELETE FROM budget_funding_allocations WHERE journal_entry_id=9001;
    INSERT INTO budget_funding_allocations(journal_entry_id,budget_category_id,kind,amount,currency,effect) VALUES
      (9001,1001,'lend',1,'JPY','apply'),(9001,1002,'lend',1,'JPY','apply');
    DELETE FROM journal_entries WHERE id=9003;
    INSERT INTO journal_entries(id,date,description,created_at) VALUES
      (9010,'2026-11-10','一回目の回収','2026-11-10 00:00:00'),
      (9011,'2026-11-05','二回目の回収','2026-11-11 00:00:00');
    INSERT INTO journal_lines(journal_entry_id,account_id,debit,credit,currency) VALUES
      (9010,1010,0,1,'JPY'),(9010,1001,1,0,'JPY'),
      (9011,1010,0,1,'JPY'),(9011,1001,1,0,'JPY');
    INSERT INTO budget_funding_allocations(journal_entry_id,budget_category_id,kind,amount,currency,effect) VALUES
      (9010,1001,'collect',1,'JPY','apply'),(9011,1002,'collect',1,'JPY','apply');
  `);

  const response = await request(value, 1010);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    source: "opening",
    allocations: [
      { budget_category_id: 1001, weight: 1 },
      { budget_category_id: 1002, weight: 1 },
    ],
    settled_minor_units: 2,
    settled_allocations: [
      { budget_category_id: 1001, minor_units: 1 },
      { budget_category_id: 1002, minor_units: 1 },
    ],
    settled_progress_available: true,
  });
});

test("starts a fresh carry sequence after an old ratio or explicit manual split", async () => {
  const value = fixture();
  const configured = await request(value, 1010, "PUT", {
    currency: "JPY",
    allocations: [
      { budget_category_id: 1001, weight: 1 },
      { budget_category_id: 1002, weight: 9 },
    ],
  });
  expect(configured.status).toBe(200);
  value.sqlite.exec(`
    UPDATE budget_funding_allocations SET amount=900
      WHERE journal_entry_id=9003 AND budget_category_id=1001;
    INSERT INTO budget_funding_allocations(journal_entry_id,budget_category_id,kind,amount,currency,effect)
      VALUES(9003,1002,'collect',100,'JPY','apply');
  `);

  const manualHistory = await request(value, 1010);
  expect(await manualHistory.json()).toMatchObject({
    settled_minor_units: 0,
    settled_allocations: [],
    settled_progress_available: true,
  });

  value.sqlite.exec(`
    INSERT INTO journal_entries(id,date,description,created_at) VALUES(9010,'2026-11-02','後から記帳した回収','2026-11-10 00:00:00');
    INSERT INTO journal_lines(journal_entry_id,account_id,debit,credit,currency) VALUES
      (9010,1010,0,10,'JPY'),(9010,1001,10,0,'JPY');
    INSERT INTO budget_funding_allocations(journal_entry_id,budget_category_id,kind,amount,currency,effect) VALUES
      (9010,1001,'collect',1,'JPY','apply'),(9010,1002,'collect',9,'JPY','apply');
  `);

  const freshSequence = await request(value, 1010);
  expect(await freshSequence.json()).toMatchObject({
    settled_minor_units: 10,
    settled_allocations: [
      { budget_category_id: 1001, minor_units: 1 },
      { budget_category_id: 1002, minor_units: 9 },
    ],
    settled_progress_available: true,
  });
});

test("missing or ambiguous settlement attribution invalidates carry until a known split resumes", async () => {
  const value = fixture();
  value.sqlite.exec("DELETE FROM budget_funding_allocations WHERE journal_entry_id=9003");
  const missing = await request(value, 1010);
  expect(await missing.json()).toMatchObject({
    settled_minor_units: 0,
    settled_allocations: [],
    settled_progress_available: false,
  });

  value.sqlite.exec(`
    INSERT INTO journal_entries(id,date,description,created_at) VALUES(9010,'2026-11-02','後から記帳した回収','2026-11-10 00:00:00');
    INSERT INTO journal_lines(journal_entry_id,account_id,debit,credit,currency) VALUES
      (9010,1010,0,10,'JPY'),(9010,1001,10,0,'JPY');
    INSERT INTO budget_funding_allocations(journal_entry_id,budget_category_id,kind,amount,currency,effect)
      VALUES(9010,1001,'collect',10,'JPY','apply');
  `);
  const resumed = await request(value, 1010);
  expect(await resumed.json()).toMatchObject({
    settled_minor_units: 10,
    settled_allocations: [{ budget_category_id: 1001, minor_units: 10 }],
    settled_progress_available: true,
  });

  value.sqlite.exec(`
    INSERT INTO journal_entries(id,date,description,created_at) VALUES(9011,'2026-11-04','複数貸付先からの回収','2026-11-12 00:00:00');
    INSERT INTO journal_lines(journal_entry_id,account_id,debit,credit,currency) VALUES
      (9011,1010,0,1,'JPY'),(9011,1012,0,1,'JPY'),(9011,1001,2,0,'JPY');
    INSERT INTO budget_funding_allocations(journal_entry_id,budget_category_id,kind,amount,currency,effect)
      VALUES(9011,1001,'collect',2,'JPY','apply');
  `);
  const ambiguous = await request(value, 1010);
  expect(await ambiguous.json()).toMatchObject({
    settled_minor_units: 0,
    settled_allocations: [],
    settled_progress_available: false,
  });
});

test("custom defaults persist, can be reset, and never change journal or budget records", async () => {
  const value = fixture();
  const before = {
    journalEntries: value.sqlite.query("SELECT COUNT(*) AS count FROM journal_entries").get(),
    funding: value.sqlite.query("SELECT COUNT(*) AS count FROM budget_funding_allocations").get(),
    adjustments: value.sqlite.query("SELECT COUNT(*) AS count FROM budget_adjustment_logs").get(),
  };
  const body = {
    currency: "JPY",
    allocations: [
      { budget_category_id: 1001, weight: 2 },
      { budget_category_id: 1002, weight: 3 },
      { budget_category_id: null, weight: 1 },
    ],
  };
  const saved = await request(value, 1010, "PUT", body);
  expect(saved.status).toBe(200);
  const savedBody = await saved.json();
  const { budget_revision: _savedRevision, ...savedConfig } = savedBody;
  expect(savedBody).toMatchObject({
    account_id: 1010,
    currency: "JPY",
    source: "custom",
    source_journal_entry_id: null,
    allocations: body.allocations,
    settled_minor_units: 0,
    settled_allocations: [],
    settled_progress_available: true,
  });
  expect(value.sqlite.query("SELECT COUNT(*) AS count FROM journal_entries").get()).toEqual(before.journalEntries);
  expect(value.sqlite.query("SELECT COUNT(*) AS count FROM budget_funding_allocations").get()).toEqual(before.funding);
  expect(value.sqlite.query("SELECT COUNT(*) AS count FROM budget_adjustment_logs").get()).toEqual(before.adjustments);

  value.sqlite.exec(`
    INSERT INTO journal_entries(id,date,description,created_at) VALUES(9010,'2026-11-10','後日の貸付','2026-11-10 00:00:00');
    INSERT INTO journal_lines(journal_entry_id,account_id,debit,credit,currency) VALUES
      (9010,1010,500,0,'JPY'),(9010,1001,0,500,'JPY');
    INSERT INTO budget_funding_allocations(journal_entry_id,budget_category_id,kind,amount,currency,effect)
      VALUES(9010,1002,'lend',500,'JPY','apply');
  `);
  const afterFixtureOpening = {
    journalEntries: value.sqlite.query("SELECT COUNT(*) AS count FROM journal_entries").get(),
    funding: value.sqlite.query("SELECT COUNT(*) AS count FROM budget_funding_allocations").get(),
    adjustments: value.sqlite.query("SELECT COUNT(*) AS count FROM budget_adjustment_logs").get(),
  };

  const reloaded = await request(value, 1010);
  expect(await reloaded.json()).toMatchObject(savedConfig);

  const reset = await request(value, 1010, "DELETE");
  expect(reset.status).toBe(200);
  expect(await reset.json()).toMatchObject({ source: "opening", source_journal_entry_id: 9001 });
  expect(value.sqlite.query("SELECT COUNT(*) AS count FROM journal_entries").get()).toEqual(afterFixtureOpening.journalEntries);
  expect(value.sqlite.query("SELECT COUNT(*) AS count FROM budget_funding_allocations").get()).toEqual(afterFixtureOpening.funding);
  expect(value.sqlite.query("SELECT COUNT(*) AS count FROM budget_adjustment_logs").get()).toEqual(afterFixtureOpening.adjustments);
});

test("deleting a category preserves its custom weight as unallocated", async () => {
  const value = fixture();
  const saved = await request(value, 1010, "PUT", {
    currency: "JPY",
    allocations: [
      { budget_category_id: 1001, weight: 2 },
      { budget_category_id: 1002, weight: 3 },
      { budget_category_id: null, weight: 1 },
    ],
  });
  expect(saved.status).toBe(200);

  value.sqlite.exec("DELETE FROM budget_categories WHERE id IN (1001,1002)");
  const afterDelete = await request(value, 1010);
  expect(await afterDelete.json()).toMatchObject({
    account_id: 1010,
    currency: "JPY",
    source: "custom",
    source_journal_entry_id: null,
    allocations: [{ budget_category_id: null, weight: 1 }],
    settled_minor_units: 1000,
    settled_allocations: [{ budget_category_id: null, minor_units: 1000 }],
    settled_progress_available: true,
  });
});

test("validates account, currency, weights, and category IDs without saving partial overrides", async () => {
  const value = fixture();
  const validBody = { currency: "JPY", allocations: [{ budget_category_id: 1002, weight: 7 }] };
  expect((await request(value, 1012, "PUT", validBody)).status).toBe(400);
  expect((await request(value, 9999)).status).toBe(404);
  expect((await request(value, 1010, "PUT", { ...validBody, currency: " " })).status).toBe(400);
  expect((await request(value, 1010, "PUT", { ...validBody, currency: "XYZ" })).status).toBe(400);
  expect((await request(value, 1010, "PUT", { ...validBody, allocations: [{ budget_category_id: 9999, weight: 1 }] })).status).toBe(400);
  expect((await request(value, 1010, "PUT", { ...validBody, allocations: [{ budget_category_id: 1001, weight: 0 }] })).status).toBe(400);
  expect(value.sqlite.query("SELECT COUNT(*) AS count FROM long_term_loan_budget_defaults").get()).toEqual({ count: 0 });
});

test("validates large category configurations within the D1 parameter limit", async () => {
  const value = createTestD1({ maxParameters: 100 });
  fixtures.push(value);
  value.sqlite.exec(`
    INSERT INTO enabled_currencies(code,decimal_places) VALUES ('JPY',0);
    INSERT INTO accounts(id,name,type,category) VALUES(1010,'Long-term loan','asset','long_term_lending');
  `);
  const insertCategory = value.sqlite.prepare("INSERT INTO budget_categories(id,name) VALUES(?,?)");
  for (let id = 1; id <= 105; id++) insertCategory.run(id, `Category ${id}`);

  const allocations = Array.from({ length: 105 }, (_, index) => ({
    budget_category_id: index + 1,
    weight: 1,
  }));
  const response = await loansRouter.request("/1010/budget-defaults", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ currency: "JPY", allocations }),
  }, { DB: value.DB });

  expect(response.status).toBe(200);
  const result = await response.json() as { allocations: Array<unknown>; source: string };
  expect(result.source).toBe("custom");
  expect(result.allocations).toHaveLength(105);
});

test("syncs defaults after their parent tables and allocations after defaults", () => {
  const accountsIndex = IMPORT_TABLE_ORDER.indexOf("accounts");
  const categoriesIndex = IMPORT_TABLE_ORDER.indexOf("budget_categories");
  const defaultsIndex = IMPORT_TABLE_ORDER.indexOf("long_term_loan_budget_defaults");
  const allocationsIndex = IMPORT_TABLE_ORDER.indexOf("long_term_loan_budget_default_allocations");

  expect(accountsIndex).toBeGreaterThanOrEqual(0);
  expect(categoriesIndex).toBeGreaterThanOrEqual(0);
  expect(defaultsIndex).toBeGreaterThan(accountsIndex);
  expect(defaultsIndex).toBeGreaterThan(categoriesIndex);
  expect(allocationsIndex).toBeGreaterThan(defaultsIndex);
});

async function createDefaultSnapshot(value: ReturnType<typeof createLoanManagementBudgetFixture>) {
  const saved = await request(value, 1010, "PUT", {
    currency: "JPY",
    allocations: [
      { budget_category_id: 1001, weight: 1 },
      { budget_category_id: 1002, weight: 1 },
    ],
  });
  expect(saved.status).toBe(200);
  const response = await request(value, 1010);
  expect(response.status).toBe(200);
  const defaults = await response.json() as { budget_revision?: number };
  expect(Number.isSafeInteger(defaults.budget_revision)).toBe(true);
  return defaults.budget_revision!;
}

function autoCollection(revision: number, description: string) {
  return {
    date: "2026-11-08",
    description,
    lines: [
      { account_id: 1001, debit: 1, credit: 0, currency: "JPY" },
      { account_id: 1010, debit: 0, credit: 1, currency: "JPY" },
    ],
    budget_funding_components: [{
      kind: "collect" as const,
      principal_amount: 1,
      applied_amount: 1,
      component_only_amount: 0,
      allocations: [{ budget_category_id: 1001, amount: 1, currency: "JPY", effect: "apply" as const }],
    }],
    loan_budget_default_snapshot: { revision, account_ids: [1010] },
  };
}

async function postJournal(value: ReturnType<typeof createLoanManagementBudgetFixture>, body: unknown, path = "/") {
  return journalRouter.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }, { DB: value.DB });
}

test("allows only one auto repayment from a shared default snapshot", async () => {
  const value = fixture();
  const revision = await createDefaultSnapshot(value);
  const beforeEntries = (value.sqlite.query("SELECT COUNT(*) AS count FROM journal_entries").get() as { count: number }).count;
  const beforeFunding = (value.sqlite.query("SELECT COUNT(*) AS count FROM budget_funding_allocations").get() as { count: number }).count;
  const responses = await Promise.all([
    postJournal(value, autoCollection(revision, "Auto collection A")),
    postJournal(value, autoCollection(revision, "Auto collection B")),
  ]);

  expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
  const stale = responses.find((response) => response.status === 409)!;
  expect(await stale.json()).toEqual({ error: "stale_loan_budget_defaults" });
  expect((value.sqlite.query("SELECT COUNT(*) AS count FROM journal_entries").get() as { count: number }).count).toBe(beforeEntries + 1);
  expect((value.sqlite.query("SELECT COUNT(*) AS count FROM budget_funding_allocations").get() as { count: number }).count).toBe(beforeFunding + 1);
});

test("a default edit invalidates a previously loaded journal snapshot", async () => {
  const value = fixture();
  const revision = await createDefaultSnapshot(value);
  const oldCount = (value.sqlite.query("SELECT COUNT(*) AS count FROM journal_entries").get() as { count: number }).count;
  const changed = await request(value, 1010, "PUT", {
    currency: "JPY",
    allocations: [{ budget_category_id: 1002, weight: 1 }],
  });
  expect(changed.status).toBe(200);

  const stale = await postJournal(value, autoCollection(revision, "Stale auto collection"));
  expect(stale.status).toBe(409);
  expect(await stale.json()).toEqual({ error: "stale_loan_budget_defaults" });
  expect((value.sqlite.query("SELECT COUNT(*) AS count FROM journal_entries").get() as { count: number }).count).toBe(oldCount);
});

test("a changed revision between validation and D1 batch rolls back the auto entry", async () => {
  const value = fixture();
  const revision = await createDefaultSnapshot(value);
  const database = value.DB as unknown as { batch: (...statements: unknown[]) => Promise<unknown> };
  const originalBatch = database.batch.bind(value.DB);
  const beforeEntries = (value.sqlite.query("SELECT COUNT(*) AS count FROM journal_entries").get() as { count: number }).count;
  let changed = false;
  database.batch = async (...statements) => {
    if (!changed) {
      changed = true;
      value.sqlite.exec("UPDATE budget_categories SET name='Concurrent budget edit' WHERE id=1001");
    }
    return originalBatch(...statements);
  };

  const response = await postJournal(value, autoCollection(revision, "Concurrent stale auto collection"));
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ error: "stale_loan_budget_defaults" });
  expect((value.sqlite.query("SELECT COUNT(*) AS count FROM journal_entries").get() as { count: number }).count).toBe(beforeEntries);
});

test("rejects a stale auto snapshot in a journal batch before inserting any entry", async () => {
  const value = fixture();
  const revision = await createDefaultSnapshot(value);
  const changed = await request(value, 1010, "PUT", {
    currency: "JPY",
    allocations: [{ budget_category_id: 1002, weight: 1 }],
  });
  expect(changed.status).toBe(200);
  const beforeEntries = (value.sqlite.query("SELECT COUNT(*) AS count FROM journal_entries").get() as { count: number }).count;
  const response = await postJournal(value, { entries: [
    { ...autoCollection(revision, "Valid but not committed"), loan_budget_default_snapshot: undefined },
    autoCollection(revision, "Stale auto collection in batch"),
  ] }, "/batch");

  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ error: "stale_loan_budget_defaults" });
  expect((value.sqlite.query("SELECT COUNT(*) AS count FROM journal_entries").get() as { count: number }).count).toBe(beforeEntries);
});

test("rejects two batch entries touching the same auto-default account and currency", async () => {
  const value = fixture();
  const revision = await createDefaultSnapshot(value);
  const beforeEntries = (value.sqlite.query("SELECT COUNT(*) AS count FROM journal_entries").get() as { count: number }).count;
  const first = autoCollection(revision, "Auto collection");
  const manual = { ...autoCollection(revision, "Manual collection"), loan_budget_default_snapshot: undefined };
  const response = await postJournal(value, { entries: [first, manual] }, "/batch");

  expect(response.status).toBe(400);
  expect((await response.json() as { error: string }).error).toBe("duplicate_loan_budget_default_snapshot");
  expect((value.sqlite.query("SELECT COUNT(*) AS count FROM journal_entries").get() as { count: number }).count).toBe(beforeEntries);
});
