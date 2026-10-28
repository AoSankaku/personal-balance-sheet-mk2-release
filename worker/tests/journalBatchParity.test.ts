import { afterEach, describe, expect, test } from "bun:test";
import { journalRouter } from "../src/routes/journal";
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
      (1011,'短期貸付','asset','short_term_lending',0,0);
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

describe("journal batch parity with normal creation", () => {
  test("persists loan opening and settlement funding the same as normal requests", async () => {
    const normal = fixture();
    const batch = fixture();

    const normalOpeningResponse = await post(normal, "/", borrowing("Borrow"));
    const batchResponse = await post(batch, "/batch", { entries: [borrowing("Borrow")] });
    expect(normalOpeningResponse.status).toBe(201);
    expect(batchResponse.status).toBe(201);
    const normalOpening = await normalOpeningResponse.json() as { id: number };
    const batchOpening = (await batchResponse.json() as { id: number }[])[0]!;
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
});
