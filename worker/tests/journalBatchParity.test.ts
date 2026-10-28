import { afterEach, describe, expect, test } from "bun:test";
import { journalRouter } from "../src/routes/journal";
import { budgetRouter } from "../src/routes/budget";
import { createIncomeBudgetScopeFixture } from "./helpers/incomeBudgetScopeFixture";

const fixtures: ReturnType<typeof createIncomeBudgetScopeFixture>[] = [];
afterEach(() => fixtures.splice(0).forEach((fixture) => fixture.close()));

function fixture() {
  const result = createIncomeBudgetScopeFixture();
  fixtures.push(result);
  result.sqlite.exec(`
    INSERT INTO enabled_currencies(code, decimal_places) VALUES ('USD', 2);
    INSERT INTO accounts(id,name,type,category,include_in_allocatable,deduct_from_budget) VALUES
      (1010,'短期借入','liability','short_term_loan',1,0),
      (1011,'短期貸付','asset','short_term_lending',0,0),
      (1012,'別の短期借入','liability','short_term_loan',1,0);
  `);
  return result;
}

function post(f: ReturnType<typeof fixture>, path: string, body: unknown) {
  return journalRouter.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }, { DB: f.DB });
}

function borrowing(description: string) {
  return {
    date: "2026-10-20",
    description,
    lines: [
      { account_id: 1001, debit: 500, credit: 0, currency: "JPY" },
      { account_id: 1010, debit: 0, credit: 500, currency: "JPY" },
    ],
    loan_settlement_opening: true,
    budget_funding_components: [{
      kind: "borrow",
      principal_amount: 500,
      applied_amount: 500,
      component_only_amount: 0,
      allocations: [{ budget_category_id: 1001, amount: 500, effect: "apply" }],
    }],
  };
}

function repayment(description: string, openingId: number) {
  return {
    date: "2026-10-21",
    description,
    lines: [
      { account_id: 1010, debit: 500, credit: 0, currency: "JPY" },
      { account_id: 1001, debit: 0, credit: 500, currency: "JPY" },
    ],
    loan_settlement_journal_entry_ids: [openingId],
    budget_funding_components: [{
      kind: "repay",
      principal_amount: 500,
      applied_amount: 500,
      component_only_amount: 0,
      source_journal_entry_ids: [openingId],
      allocations: [{ budget_category_id: 1001, amount: 500, effect: "apply", source_journal_entry_id: openingId }],
    }],
  };
}

function lending(description: string) {
  return {
    date: "2026-10-20",
    description,
    lines: [
      { account_id: 1011, debit: 500, credit: 0, currency: "JPY" },
      { account_id: 1001, debit: 0, credit: 500, currency: "JPY" },
    ],
    loan_settlement_opening: true,
    budget_funding_components: [{
      kind: "lend",
      principal_amount: 500,
      applied_amount: 500,
      component_only_amount: 0,
      allocations: [{ budget_category_id: 1001, amount: 500, effect: "apply" }],
    }],
  };
}

function lendingFromExcludedCash(description: string) {
  return {
    date: "2026-10-20",
    description,
    lines: [
      { account_id: 1011, debit: 500, credit: 0, currency: "JPY" },
      { account_id: 1002, debit: 0, credit: 500, currency: "JPY" },
    ],
    loan_settlement_opening: true,
    budget_funding_components: [{
      kind: "lend",
      principal_amount: 500,
      applied_amount: 0,
      component_only_amount: 500,
      allocations: [{ budget_category_id: null, amount: 500, effect: "component_only" }],
    }],
  };
}

function collectionToExcludedCash(description: string, openingId: number) {
  return {
    ...collection(description, openingId),
    lines: [
      { account_id: 1002, debit: 500, credit: 0, currency: "JPY" },
      { account_id: 1011, debit: 0, credit: 500, currency: "JPY" },
    ],
  };
}

function collection(description: string, openingId: number) {
  return {
    date: "2026-10-21",
    description,
    lines: [
      { account_id: 1001, debit: 500, credit: 0, currency: "JPY" },
      { account_id: 1011, debit: 0, credit: 500, currency: "JPY" },
    ],
    loan_settlement_journal_entry_ids: [openingId],
    budget_funding_components: [{
      kind: "collect",
      principal_amount: 500,
      applied_amount: 500,
      component_only_amount: 0,
      source_journal_entry_ids: [openingId],
      allocations: [{ budget_category_id: 1001, amount: 500, effect: "apply", source_journal_entry_id: openingId }],
    }],
  };
}

function legacyRepayment(description: string, openingId: number) {
  return {
    date: "2026-10-21",
    description,
    lines: [
      { account_id: 1010, debit: 500, credit: 0, currency: "JPY" },
      { account_id: 1001, debit: 0, credit: 500, currency: "JPY" },
    ],
    loan_settlement_journal_entry_ids: [openingId],
  };
}

describe("journal batch parity with normal creation", () => {
  test("persists loan opening and settlement funding the same as normal requests", async () => {
    const normal = fixture();
    const batch = fixture();

    const normalOpeningResponse = await post(normal, "/", borrowing("Borrow"));
    const batchResponse = await post(batch, "/batch", { entries: [borrowing("Borrow")] });
    expect(normalOpeningResponse.status).toBe(201);
    expect(batchResponse.status).toBe(201);
    const normalOpening = await normalOpeningResponse.json() as { id: number };
    const batchOpening = (await batchResponse.json() as { id: number; source: string }[])[0]!;
    expect(batchOpening.source).toBe("csv_import");
    expect(batch.sqlite.query("SELECT is_settled FROM loan_settlements WHERE journal_entry_id=?").get(batchOpening.id))
      .toEqual(normal.sqlite.query("SELECT is_settled FROM loan_settlements WHERE journal_entry_id=?").get(normalOpening.id));
    expect(batch.sqlite.query("SELECT kind, budget_category_id, amount, currency, effect FROM budget_funding_allocations WHERE journal_entry_id=?").all(batchOpening.id))
      .toEqual(normal.sqlite.query("SELECT kind, budget_category_id, amount, currency, effect FROM budget_funding_allocations WHERE journal_entry_id=?").all(normalOpening.id));

    const normalRepayResponse = await post(normal, "/", repayment("Repay", normalOpening.id));
    const batchRepayResponse = await post(batch, "/batch", { entries: [repayment("Repay", batchOpening.id)] });
    expect(normalRepayResponse.status).toBe(201);
    expect(batchRepayResponse.status).toBe(201);
    const batchRepay = (await batchRepayResponse.json() as { id: number }[])[0]!;
    expect(batch.sqlite.query("SELECT kind, source_journal_entry_id, amount, effect FROM budget_funding_allocations WHERE journal_entry_id=? ORDER BY id").all(batchRepay.id))
      .toEqual(normal.sqlite.query("SELECT kind, source_journal_entry_id, amount, effect FROM budget_funding_allocations WHERE journal_entry_id=(SELECT MAX(id) FROM journal_entries) ORDER BY id").all());
    expect(batch.sqlite.query("SELECT is_settled, settled_by_journal_entry_id FROM loan_settlements WHERE journal_entry_id=?").get(batchOpening.id))
      .toMatchObject({ is_settled: 1, settled_by_journal_entry_id: batchRepay.id });
  });

  test("persists lending and collection funding the same as normal requests", async () => {
    const normal = fixture();
    const batch = fixture();

    const normalOpeningResponse = await post(normal, "/", lending("Lend"));
    const batchResponse = await post(batch, "/batch", { entries: [lending("Lend")] });
    expect(normalOpeningResponse.status).toBe(201);
    expect(batchResponse.status).toBe(201);
    const normalOpening = await normalOpeningResponse.json() as { id: number };
    const batchOpening = (await batchResponse.json() as { id: number }[])[0]!;
    expect(batch.sqlite.query("SELECT kind, budget_category_id, amount, effect FROM budget_funding_allocations WHERE journal_entry_id=?").all(batchOpening.id))
      .toEqual(normal.sqlite.query("SELECT kind, budget_category_id, amount, effect FROM budget_funding_allocations WHERE journal_entry_id=?").all(normalOpening.id));

    const normalCollect = await post(normal, "/", collection("Collect", normalOpening.id));
    const batchCollect = await post(batch, "/batch", { entries: [collection("Collect", batchOpening.id)] });
    expect(normalCollect.status).toBe(201);
    expect(batchCollect.status).toBe(201);
    const batchCollectEntry = (await batchCollect.json() as { id: number }[])[0]!;
    expect(batch.sqlite.query("SELECT kind, source_journal_entry_id, amount, effect FROM budget_funding_allocations WHERE journal_entry_id=? ORDER BY id").all(batchCollectEntry.id))
      .toEqual(normal.sqlite.query("SELECT kind, source_journal_entry_id, amount, effect FROM budget_funding_allocations WHERE journal_entry_id=(SELECT MAX(id) FROM journal_entries) ORDER BY id").all());
    expect(batch.sqlite.query("SELECT is_settled, settled_by_journal_entry_id FROM loan_settlements WHERE journal_entry_id=?").get(batchOpening.id))
      .toMatchObject({ is_settled: 1, settled_by_journal_entry_id: batchCollectEntry.id });
  });

  test("re-splits source categories by the settlement's current tracked cash impact", async () => {
    const trackedOpeningFixture = fixture();
    const trackedOpeningResponse = await post(trackedOpeningFixture, "/", lending("Tracked lend"));
    const trackedOpening = await trackedOpeningResponse.json() as { id: number };
    const trackedToExcluded = await post(trackedOpeningFixture, "/batch", {
      entries: [collectionToExcludedCash("Collect into excluded cash", trackedOpening.id)],
    });
    expect(trackedToExcluded.status).toBe(201);
    const [excludedCollection] = await trackedToExcluded.json() as { id: number }[];
    expect(trackedOpeningFixture.sqlite.query("SELECT kind, budget_category_id, amount, effect FROM budget_funding_allocations WHERE journal_entry_id=?").all(excludedCollection!.id))
      .toEqual([{ kind: "collect", budget_category_id: 1001, amount: 500, effect: "component_only" }]);
    const trackedSummary = await budgetRouter.request("/summary?year_month=2026-10&as_of=2026-10-22&currency=JPY", {}, { DB: trackedOpeningFixture.DB });
    const trackedData = await trackedSummary.json() as { categories: { category: { id: number }; available: number }[] };
    expect(trackedData.categories.find((row) => row.category.id === 1001)?.available).toBe(9500);

    const excludedOpeningFixture = fixture();
    const excludedOpeningResponse = await post(excludedOpeningFixture, "/", lendingFromExcludedCash("Excluded lend"));
    const excludedOpening = await excludedOpeningResponse.json() as { id: number };
    const excludedToTracked = await post(excludedOpeningFixture, "/batch", {
      entries: [collection("Collect into tracked cash", excludedOpening.id)],
    });
    expect(excludedToTracked.status).toBe(201);
    const [trackedCollection] = await excludedToTracked.json() as { id: number }[];
    expect(excludedOpeningFixture.sqlite.query("SELECT kind, budget_category_id, amount, effect FROM budget_funding_allocations WHERE journal_entry_id=?").all(trackedCollection!.id))
      .toEqual([{ kind: "collect", budget_category_id: null, amount: 500, effect: "apply" }]);
  });

  test("preserves the legacy source-ID-only settlement fallback in normal and batch APIs", async () => {
    const normal = fixture();
    const batch = fixture();
    const normalOpening = await post(normal, "/", borrowing("Borrow"));
    const batchOpening = await post(batch, "/batch", { entries: [borrowing("Borrow")] });
    expect(normalOpening.status).toBe(201);
    expect(batchOpening.status).toBe(201);
    const normalId = (await normalOpening.json() as { id: number }).id;
    const batchId = ((await batchOpening.json() as { id: number }[])[0]!).id;

    const normalSettlement = await post(normal, "/", legacyRepayment("Repay", normalId));
    const batchSettlement = await post(batch, "/batch", { entries: [legacyRepayment("Repay", batchId)] });
    expect(normalSettlement.status).toBe(201);
    expect(batchSettlement.status).toBe(201);
    const [batchSettled] = await batchSettlement.json() as { id: number; source: string }[];
    expect(batchSettled!.source).toBe("csv_import");
    const batchSettledId = batchSettled!.id;
    expect(batch.sqlite.query("SELECT kind, budget_category_id, source_journal_entry_id, effect FROM budget_funding_allocations WHERE journal_entry_id=?").all(batchSettledId))
      .toEqual(normal.sqlite.query("SELECT kind, budget_category_id, source_journal_entry_id, effect FROM budget_funding_allocations WHERE journal_entry_id=(SELECT MAX(id) FROM journal_entries)").all());
  });

  test("keeps income allocation, transfer destination, and defer flag in a batch", async () => {
    const f = fixture();
    const response = await post(f, "/batch", { entries: [{
      date: "2026-10-20",
      description: "Interest",
      lines: [
        { account_id: 1001, debit: 250, credit: 0, currency: "JPY" },
        { account_id: 1005, debit: 0, credit: 250, currency: "JPY" },
      ],
      income_budget_allocations: [{ budget_category_id: 1001, amount: 250, currency: "JPY" }],
      income_transfer_destinations: [{ budget_category_id: 1001, from_account_id: 1001, to_account_id: 1007, amount: 250, currency: "JPY", is_deferred: true }],
    }] });
    expect(response.status).toBe(201);
    const [entry] = await response.json() as { id: number }[];
    expect(f.sqlite.query("SELECT amount, adjustment_type FROM budget_adjustment_logs WHERE journal_entry_id=?").get(entry!.id))
      .toEqual({ amount: 250, adjustment_type: "allocation" });
    expect(f.sqlite.query("SELECT amount, currency, is_deferred FROM income_transfer_requirements WHERE source_income_journal_entry_id=?").get(entry!.id))
      .toEqual({ amount: 250, currency: "JPY", is_deferred: 1 });
  });

  test("validates and stores foreign currency precision in a batch", async () => {
    const f = fixture();
    const response = await post(f, "/batch", { entries: [{
      date: "2026-10-20",
      description: "USD expense",
      lines: [
        { account_id: 1006, debit: 9.65, credit: 0, currency: "USD" },
        { account_id: 1001, debit: 0, credit: 9.65, currency: "USD" },
      ],
      budget_allocations: [{ budget_category_id: 1001, amount: -9.65, currency: "USD" }],
      budget_source: "simple",
    }] });
    expect(response.status).toBe(201);
    expect(f.sqlite.query("SELECT amount, currency FROM journal_entry_budget_allocations").get())
      .toEqual({ amount: -965, currency: "USD" });
  });

  test("rejects an invalid later entry without writing earlier valid entries", async () => {
    const f = fixture();
    const response = await post(f, "/batch", { entries: [
      borrowing("Valid first"),
      { ...borrowing("Unbalanced later"), lines: [
        { account_id: 1001, debit: 500, credit: 0, currency: "JPY" },
        { account_id: 1010, debit: 0, credit: 499, currency: "JPY" },
      ] },
    ] });
    expect(response.status).toBe(400);
    expect(f.sqlite.query("SELECT COUNT(*) AS n FROM journal_entries WHERE id>9000").get()).toEqual({ n: 0 });
    expect(f.sqlite.query("SELECT COUNT(*) AS n FROM loan_settlements").get()).toEqual({ n: 0 });
    expect(f.sqlite.query("SELECT COUNT(*) AS n FROM budget_funding_allocations").get()).toEqual({ n: 0 });
  });

  test("rejects duplicate settlement sources before writing any batch entries", async () => {
    const f = fixture();
    const openingResponse = await post(f, "/", borrowing("Existing opening"));
    const opening = await openingResponse.json() as { id: number };
    const response = await post(f, "/batch", { entries: [
      repayment("First settlement", opening.id),
      repayment("Duplicate settlement", opening.id),
    ] });
    expect(response.status).toBe(400);
    expect(f.sqlite.query("SELECT COUNT(*) AS n FROM journal_entries WHERE id>9000").get()).toEqual({ n: 1 });
    expect(f.sqlite.query("SELECT is_settled FROM loan_settlements WHERE journal_entry_id=?").get(opening.id)).toEqual({ is_settled: 0 });
  });

  test("rejects a stale settlement source and preserves the existing settlement", async () => {
    const f = fixture();
    const openingResponse = await post(f, "/", borrowing("Existing opening"));
    const opening = await openingResponse.json() as { id: number };
    const first = await post(f, "/", repayment("First settlement", opening.id));
    expect(first.status).toBe(201);
    const beforeCount = (f.sqlite.query("SELECT COUNT(*) AS n FROM journal_entries").get() as { n: number }).n;

    const stale = await post(f, "/batch", { entries: [repayment("Stale settlement", opening.id)] });
    expect(stale.status).toBe(400);
    expect(f.sqlite.query("SELECT COUNT(*) AS n FROM journal_entries").get()).toEqual({ n: beforeCount });
    expect(f.sqlite.query("SELECT is_settled FROM loan_settlements WHERE journal_entry_id=?").get(opening.id)).toEqual({ is_settled: 1 });
  });

  test("allows editing a settlement with its own currently settled source", async () => {
    const f = fixture();
    const openingResponse = await post(f, "/", borrowing("Opening"));
    const opening = await openingResponse.json() as { id: number };
    const settlementResponse = await post(f, "/", repayment("Repayment", opening.id));
    const settlement = await settlementResponse.json() as { id: number };

    const edited = await journalRouter.request(`/${settlement.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(repayment("Edited repayment", opening.id)),
    }, { DB: f.DB });
    expect(edited.status).toBe(200);
    expect(f.sqlite.query("SELECT is_settled, settled_by_journal_entry_id FROM loan_settlements WHERE journal_entry_id=?").get(opening.id))
      .toEqual({ is_settled: 1, settled_by_journal_entry_id: settlement.id });
  });

  test("rolls back when a source becomes settled without changing the budget revision", async () => {
    const f = fixture();
    const openingResponse = await post(f, "/", borrowing("Opening"));
    const opening = await openingResponse.json() as { id: number };
    const database = f.DB as unknown as {
      batch: (...statements: unknown[]) => Promise<unknown>;
    };
    const originalBatch = database.batch.bind(f.DB);
    let changed = false;
    database.batch = async (...statements) => {
      if (!changed) {
        changed = true;
        f.sqlite.exec(`UPDATE loan_settlements SET is_settled=1, settled_by_journal_entry_id=NULL WHERE journal_entry_id=${opening.id}`);
      }
      return originalBatch(...statements);
    };
    const beforeCount = (f.sqlite.query("SELECT COUNT(*) AS n FROM journal_entries").get() as { n: number }).n;
    const response = await post(f, "/", legacyRepayment("Concurrent settlement", opening.id));
    expect(response.status).toBe(409);
    expect(f.sqlite.query("SELECT COUNT(*) AS n FROM journal_entries").get()).toEqual({ n: beforeCount });
    expect(f.sqlite.query("SELECT is_settled, settled_by_journal_entry_id FROM loan_settlements WHERE journal_entry_id=?").get(opening.id))
      .toEqual({ is_settled: 1, settled_by_journal_entry_id: null });
  });

  test("requires funding references to use the selected settlement source", async () => {
    const f = fixture();
    const firstOpeningResponse = await post(f, "/", borrowing("First opening"));
    const secondOpeningResponse = await post(f, "/", borrowing("Second opening"));
    const firstOpening = await firstOpeningResponse.json() as { id: number };
    const secondOpening = await secondOpeningResponse.json() as { id: number };
    const mismatched = repayment("Mismatched source metadata", firstOpening.id);
    mismatched.budget_funding_components[0]!.source_journal_entry_ids = [secondOpening.id];
    mismatched.budget_funding_components[0]!.allocations[0]!.source_journal_entry_id = secondOpening.id;
    const beforeCount = (f.sqlite.query("SELECT COUNT(*) AS n FROM journal_entries").get() as { n: number }).n;
    const response = await post(f, "/batch", { entries: [mismatched] });
    expect(response.status).toBe(400);
    expect(f.sqlite.query("SELECT COUNT(*) AS n FROM journal_entries").get()).toEqual({ n: beforeCount });
    expect(f.sqlite.query("SELECT is_settled FROM loan_settlements WHERE journal_entry_id IN (?,?) ORDER BY journal_entry_id").all(firstOpening.id, secondOpening.id))
      .toEqual([{ is_settled: 0 }, { is_settled: 0 }]);
  });

  test("uses the opening's current saved category split if the editor has a stale snapshot", async () => {
    const f = fixture();
    f.sqlite.exec("INSERT INTO budget_categories(id,name) VALUES(1002,'Updated category')");
    const openingResponse = await post(f, "/", borrowing("Opening"));
    const opening = await openingResponse.json() as { id: number };
    f.sqlite.prepare("UPDATE budget_funding_allocations SET budget_category_id=1002 WHERE journal_entry_id=?").run(opening.id);

    const staleEditorPayload = repayment("Repay with stale editor snapshot", opening.id);
    const response = await post(f, "/batch", { entries: [staleEditorPayload] });
    expect(response.status).toBe(201);
    const [entry] = await response.json() as { id: number }[];
    expect(f.sqlite.query("SELECT kind, budget_category_id, source_journal_entry_id, amount FROM budget_funding_allocations WHERE journal_entry_id=?").all(entry!.id))
      .toEqual([{ kind: "repay", budget_category_id: 1002, source_journal_entry_id: opening.id, amount: 500 }]);
  });

  test("requires a selected opening to match loan account, currency, date, and full principal", async () => {
    const f = fixture();
    const otherAccountOpeningBody = borrowing("Other loan account");
    otherAccountOpeningBody.lines[1]!.account_id = 1012;
    const otherAccountResponse = await post(f, "/", otherAccountOpeningBody);
    const otherAccountOpening = await otherAccountResponse.json() as { id: number };
    const wrongAccountResponse = await post(f, "/batch", { entries: [repayment("Wrong loan account", otherAccountOpening.id)] });
    expect(wrongAccountResponse.status).toBe(400);

    const openingResponse = await post(f, "/", borrowing("Opening"));
    const opening = await openingResponse.json() as { id: number };
    const wrongDirection = await post(f, "/batch", { entries: [collection("Wrong loan account", opening.id)] });
    expect(wrongDirection.status).toBe(400);

    const tooEarly = await post(f, "/", { ...repayment("Before opening", opening.id), date: "2026-10-19" });
    expect(tooEarly.status).toBe(400);

    const partial = repayment("Partial principal", opening.id);
    partial.lines[0]!.debit = 400;
    partial.lines[1]!.credit = 400;
    partial.budget_funding_components[0]!.principal_amount = 400;
    partial.budget_funding_components[0]!.applied_amount = 400;
    partial.budget_funding_components[0]!.allocations[0]!.amount = 400;
    const partialResponse = await post(f, "/batch", { entries: [partial] });
    expect(partialResponse.status).toBe(400);
    expect(f.sqlite.query("SELECT COUNT(*) AS n FROM journal_entries WHERE id>9002").get()).toEqual({ n: 0 });
  });

  test("does not restore pre-reset source funding when its opening is settled later", async () => {
    const f = fixture();
    const openingResponse = await post(f, "/", borrowing("Pre-reset opening"));
    const opening = await openingResponse.json() as { id: number };
    f.sqlite.exec(`INSERT INTO budget_adjustment_logs(budget_category_id,year_month,amount,currency,date,adjustment_type)
      VALUES(1001,'2026-10',0,'JPY','2026-10-21','reset')`);

    const settled = await post(f, "/batch", { entries: [repayment("Post-reset settlement", opening.id)] });
    expect(settled.status).toBe(201);
    const summary = await budgetRouter.request("/summary?year_month=2026-10&as_of=2026-10-22&currency=JPY", {}, { DB: f.DB });
    expect(summary.status).toBe(200);
    const data = await summary.json() as { categories: { category: { id: number }; available: number }[] };
    expect(data.categories.find((row) => row.category.id === 1001)?.available).toBe(0);
    const [entry] = await settled.json() as { id: number }[];
    expect(f.sqlite.query("SELECT kind, budget_category_id, source_journal_entry_id, effect FROM budget_funding_allocations WHERE journal_entry_id=?").all(entry!.id))
      .toEqual([{ kind: "repay", budget_category_id: 1001, source_journal_entry_id: opening.id, effect: "apply" }]);
  });
});
