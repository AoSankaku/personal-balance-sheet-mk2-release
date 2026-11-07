import { afterEach, expect, test } from "bun:test";
import { loansRouter } from "../src/routes/loans";
import { createLoanManagementBudgetFixture } from "./helpers/loanManagementBudgetFixture";

const fixtures: ReturnType<typeof createLoanManagementBudgetFixture>[] = [];
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
) {
  return loansRouter.request(`/${accountId}/budget-defaults?currency=${currency}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }, { DB: value.DB });
}

test("borrowing and lending defaults inherit the earliest opening split per currency", async () => {
  const value = fixture();
  for (const [accountId, sourceEntryId] of [[1010, 9001], [1011, 9002]] as const) {
    const response = await request(value, accountId);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      account_id: accountId,
      currency: "JPY",
      source: "opening",
      source_journal_entry_id: sourceEntryId,
      allocations: [{ budget_category_id: 1001, weight: 1 }],
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
  expect(await missingFirstSplit.json()).toEqual({
    account_id: 1010,
    currency: "JPY",
    source: "unavailable",
    source_journal_entry_id: 9001,
    allocations: [{ budget_category_id: null, weight: 1 }],
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
  expect(savedBody).toEqual({
    account_id: 1010,
    currency: "JPY",
    source: "custom",
    source_journal_entry_id: null,
    allocations: body.allocations,
  });

  const reloaded = await request(value, 1010);
  expect(await reloaded.json()).toEqual(savedBody);

  const reset = await request(value, 1010, "DELETE");
  expect(reset.status).toBe(200);
  expect(await reset.json()).toMatchObject({ source: "opening", source_journal_entry_id: 9001 });
  expect(value.sqlite.query("SELECT COUNT(*) AS count FROM journal_entries").get()).toEqual(before.journalEntries);
  expect(value.sqlite.query("SELECT COUNT(*) AS count FROM budget_funding_allocations").get()).toEqual(before.funding);
  expect(value.sqlite.query("SELECT COUNT(*) AS count FROM budget_adjustment_logs").get()).toEqual(before.adjustments);
});

test("validates account, currency, weights, and category IDs without saving partial overrides", async () => {
  const value = fixture();
  const validBody = { currency: "JPY", allocations: [{ budget_category_id: 1002, weight: 7 }] };
  expect((await request(value, 1012, "PUT", validBody)).status).toBe(400);
  expect((await request(value, 9999)).status).toBe(404);
  expect((await request(value, 1010, "PUT", { ...validBody, currency: "XYZ" })).status).toBe(400);
  expect((await request(value, 1010, "PUT", { ...validBody, allocations: [{ budget_category_id: 9999, weight: 1 }] })).status).toBe(400);
  expect((await request(value, 1010, "PUT", { ...validBody, allocations: [{ budget_category_id: 1001, weight: 0 }] })).status).toBe(400);
  expect(value.sqlite.query("SELECT COUNT(*) AS count FROM long_term_loan_budget_defaults").get()).toEqual({ count: 0 });
});
