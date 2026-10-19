import { afterEach, expect, test } from "bun:test";
import { createTestD1 } from "./helpers/d1";
import { accountsRouter } from "../src/routes/accounts";
import { budgetRouter } from "../src/routes/budget";
import { depreciationRouter } from "../src/routes/depreciation";
import { sumBudgetResourceBalances } from "../../shared/budgetScope";
import type {
  DepreciationBudgetPreview,
  DepreciationBudgetSettings,
} from "../../shared/depreciationBudget";

const handles: ReturnType<typeof createTestD1>[] = [];
afterEach(() => {
  for (const handle of handles.splice(0)) handle.close();
});

interface FixtureOptions {
  currency?: string;
  totalAmount?: number;
  cashOutflow?: number;
  months?: number;
  startDate?: string;
  extraCategory?: boolean;
}

function storageAmount(amount: number, currency: string) {
  return Math.round(amount * (currency === "USD" ? 100 : 1));
}

function firstOfMonth(date: string, offset: number) {
  const [year, month] = date.split("-").map(Number) as [number, number, number];
  const next = new Date(Date.UTC(year, month - 1 + offset, 1));
  return next.toISOString().slice(0, 10);
}

function fixture(options: FixtureOptions = {}) {
  const handle = createTestD1();
  handles.push(handle);
  const currency = options.currency ?? "JPY";
  const totalAmount = storageAmount(options.totalAmount ?? 300_000, currency);
  const cashOutflow = storageAmount(options.cashOutflow ?? options.totalAmount ?? 300_000, currency);
  const months = options.months ?? 30;
  const startDate = options.startDate ?? "2026-01-01";
  const hasExtraCategory = options.extraCategory ?? true;
  if (currency !== "JPY") {
    handle.sqlite
      .query("INSERT INTO enabled_currencies(code, decimal_places) VALUES(?, 2)")
      .run(currency);
  }
  handle.sqlite.exec(`
    INSERT INTO accounts(id,name,type,category,include_in_allocatable,is_depreciable,deduct_from_budget) VALUES
      (1001,'Bank','asset','cash',1,0,0),
      (1002,'Equipment','asset','property',0,1,0),
      (1003,'Depreciation expense','expense','other',1,0,0),
      (1004,'Opening balance','equity','opening_balance',1,0,0),
      (1005,'Untracked payable','liability','other',1,0,0);
    INSERT INTO budget_categories(id,name) VALUES(1001,'Purchase reserve'),(1002,'Monthly source');
  `);
  if (hasExtraCategory) {
    handle.sqlite.exec("INSERT INTO budget_categories(id,name) VALUES(1003,'Other budget')");
  }
  const cashOpening = storageAmount(1_000_000, currency);
  const purchaseBudget = storageAmount(300_000, currency);
  const sourceBudget = storageAmount(100_000, currency);
  handle.sqlite
    .query(`INSERT INTO journal_entries(id,date,description,created_at)
      VALUES(900,'2025-12-31','Opening balance','2025-12-31 08:00:00')`)
    .run();
  handle.sqlite
    .query(`INSERT INTO journal_lines(journal_entry_id,account_id,debit,credit,currency)
      VALUES(900,1001,?,0,?),(900,1004,0,?,?)`)
    .run(cashOpening, currency, cashOpening, currency);
  for (const [categoryId, amount] of [
    [1001, purchaseBudget],
    [1002, sourceBudget],
  ] as const) {
    handle.sqlite
      .query(`INSERT INTO budget_adjustment_logs
        (budget_category_id,year_month,amount,currency,date,created_at,adjustment_type)
        VALUES(?,'2025-12',?,?,'2025-12-31','2025-12-31 09:00:00','allocation')`)
      .run(categoryId, amount, currency);
  }

  const sourceDate = startDate;
  const purchaseCreatedAt = `${sourceDate} 08:00:00`;
  handle.sqlite
    .query("INSERT INTO journal_entries(date,description,created_at) VALUES(?,?,?)")
    .run(sourceDate, "Equipment purchase", purchaseCreatedAt);
  const purchaseJournalId = Number(
    (handle.sqlite.query("SELECT last_insert_rowid() AS id").get() as { id: number }).id,
  );
  const untrackedCredit = totalAmount - cashOutflow;
  handle.sqlite
    .query(`INSERT INTO journal_lines(journal_entry_id,account_id,debit,credit,currency)
      VALUES(?,1002,?,0,?),(?,1001,0,?,?)`)
    .run(purchaseJournalId, totalAmount, currency, purchaseJournalId, cashOutflow, currency);
  if (untrackedCredit > 0) {
    handle.sqlite
      .query(`INSERT INTO journal_lines(journal_entry_id,account_id,debit,credit,currency)
        VALUES(?,1005,0,?,?)`)
      .run(purchaseJournalId, untrackedCredit, currency);
  }
  const scheduleId = Number(
    (handle.sqlite.query(`INSERT INTO depreciation_schedules
      (source_journal_entry_id,asset_account_id,expense_account_id,total_amount,months,start_date,description,budget_currency)
      VALUES(?,1002,1003,?,?,?,'Equipment',?) RETURNING id`)
      .get(purchaseJournalId, totalAmount, months, startDate, currency) as { id: number }).id,
  );
  const quotient = Math.floor(totalAmount / months);
  const remainder = totalAmount % months;
  const monthlyEntries: { id: number; month: number; date: string; amount: number; created_at: string }[] = [];
  for (let index = 0; index < months; index += 1) {
    const month = index + 1;
    const date = firstOfMonth(startDate, index);
    const createdAt = `${date} 10:00:00`;
    handle.sqlite
      .query("INSERT INTO journal_entries(date,description,created_at) VALUES(?,?,?)")
      .run(date, `Depreciation ${month}`, createdAt);
    const journalId = Number(
      (handle.sqlite.query("SELECT last_insert_rowid() AS id").get() as { id: number }).id,
    );
    const amount = quotient + (index < remainder ? 1 : 0);
    handle.sqlite
      .query(`INSERT INTO depreciation_entries(schedule_id,journal_entry_id,month_number)
        VALUES(?,?,?)`)
      .run(scheduleId, journalId, month);
    handle.sqlite
      .query(`INSERT INTO journal_lines(journal_entry_id,account_id,debit,credit,currency)
        VALUES(?,1003,?,0,?),(?,1002,0,?,?)`)
      .run(journalId, amount, currency, journalId, amount, currency);
    monthlyEntries.push({ id: journalId, month, date, amount, created_at: createdAt });
  }
  return {
    ...handle,
    currency,
    scheduleId,
    purchaseJournalId,
    totalAmount,
    monthlyEntries,
  };
}

function assignedSettings(): DepreciationBudgetSettings {
  return {
    method: "assigned",
    purchase_category_id: 1001,
    monthly_source_category_id: 1002,
  };
}

function specialSettings(): DepreciationBudgetSettings {
  return { method: "special", monthly_source_category_id: 1002 };
}

async function post(
  handle: ReturnType<typeof fixture>,
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
    { DB: handle.DB },
  );
}

async function preview(
  handle: ReturnType<typeof fixture>,
  settings: DepreciationBudgetSettings,
) {
  const response = await post(
    handle,
    `/${handle.scheduleId}/budget/preview`,
    { settings },
  );
  expect(response.status).toBe(200);
  return (await response.json()) as DepreciationBudgetPreview;
}

async function apply(
  handle: ReturnType<typeof fixture>,
  plan: DepreciationBudgetPreview,
) {
  return post(handle, `/${handle.scheduleId}/budget/apply`, {
    token: plan.token,
    settings: plan.settings,
    confirmed: true,
  });
}

async function snapshot(handle: ReturnType<typeof fixture>, date: string) {
  const accountResponse = await accountsRouter.request(`/?as_of=${date}`, {}, { DB: handle.DB });
  expect(accountResponse.status).toBe(200);
  const T = sumBudgetResourceBalances(
    (await accountResponse.json()) as Parameters<typeof sumBudgetResourceBalances>[0],
    handle.currency,
  );
  const budgetResponse = await budgetRouter.request(
    `/summary?year_month=${date.slice(0, 7)}&as_of=${date}&currency=${handle.currency}`,
    {},
    { DB: handle.DB },
  );
  expect(budgetResponse.status).toBe(200);
  const budget = (await budgetResponse.json()) as {
    categories: { category: { id: number; name: string }; available: number }[];
  };
  const balances = Object.fromEntries(
    budget.categories.map((row) => [row.category.id, row.available]),
  );
  const B = Object.values(balances).reduce((sum, amount) => sum + amount, 0);
  const D = Object.values(balances).reduce((sum, amount) => sum + Math.max(-amount, 0), 0);
  return { T, U: T - B, B, D, allocatable: T - B - D, balances, categories: budget.categories };
}

function addResetGroup(
  handle: ReturnType<typeof fixture>,
  options: {
    categories?: number[];
    date?: string;
    createdAt?: string;
    scope?: "category" | "all" | null;
    groupKey?: string | null;
  } = {},
) {
  const date = options.date ?? "2026-02-15";
  const createdAt = options.createdAt ?? `${date} 12:00:00`;
  const categories = options.categories ?? [1001, 1002];
  return categories.map((categoryId) => {
    const row = handle.sqlite.query(`INSERT INTO budget_adjustment_logs
      (budget_category_id,year_month,amount,currency,date,created_at,adjustment_type,reset_scope,reset_group_key)
      VALUES(?,?,0,?,?,?,'reset',?,?) RETURNING id`)
      .get(categoryId, date.slice(0, 7), handle.currency, date, createdAt, options.scope ?? null, options.groupKey ?? null) as { id: number };
    return row.id;
  });
}

test("purchase target and repaired snapshot use only the tracked budget-account outflow", async () => {
  const handle = fixture({ cashOutflow: 180_000, totalAmount: 300_000 });
  const plan = await preview(handle, assignedSettings());
  expect(plan.progress.target_amount).toBe(180_000);
  expect(plan.changes.find((change) => change.event.kind === "purchase")?.event.amount).toBe(180_000);

  const purchasePoint = plan.timeline.find((point) => point.label === "purchase");
  expect(purchasePoint).toBeDefined();
  expect(purchasePoint!.before).toMatchObject({ T: 820_000, U: 420_000 });
  expect(purchasePoint!.after).toMatchObject({ T: 820_000, U: 600_000 });
  expect(purchasePoint!.before.categories.reduce((sum, category) => sum + category.balance, 0)).toBe(400_000);
  expect(purchasePoint!.after.categories.reduce((sum, category) => sum + category.balance, 0)).toBe(220_000);
});

test("repair replaces legacy purchase allocation, monthly allocations, and reservation without changing ledger rows", async () => {
  const handle = fixture();
  handle.sqlite.query(`INSERT INTO journal_entry_budget_allocations
    (journal_entry_id,budget_category_id,amount,currency,source,created_at)
    VALUES(?,1001,?,'JPY','depreciation',?)`)
    .run(handle.purchaseJournalId, -300_000, "2026-01-01 08:00:00");
  for (const entry of handle.monthlyEntries) {
    handle.sqlite.query(`INSERT INTO journal_entry_budget_allocations
      (journal_entry_id,budget_category_id,amount,currency,source,created_at)
      VALUES(?,1001,?,'JPY','depreciation',?)`)
      .run(entry.id, -entry.amount, entry.created_at);
  }
  handle.sqlite.query(`INSERT INTO depreciation_budget_reservations
    (schedule_id,budget_category_id,amount,currency,created_at)
    VALUES(?,1001,300000,'JPY','2026-01-01 08:00:00')`)
    .run(handle.scheduleId);

  const purchaseTime = await snapshot(handle, "2026-01-01");
  const originalLedgerRows = handle.sqlite.query(`SELECT id,journal_entry_id,account_id,debit,credit,currency
    FROM journal_lines WHERE journal_entry_id=? OR journal_entry_id IN
      (SELECT journal_entry_id FROM depreciation_entries WHERE schedule_id=?) ORDER BY id`)
    .all(handle.purchaseJournalId, handle.scheduleId);
  expect(purchaseTime.T).toBe(700_000);
  expect(purchaseTime.B).toBe(-200_000);

  const plan = await preview(handle, assignedSettings());
  expect(plan.can_apply).toBe(true);
  const purchasePoint = plan.timeline.find((point) => point.label === "purchase")!;
  expect(purchasePoint.before).toMatchObject({ T: 700_000, U: 900_000 });
  expect(purchasePoint.after).toMatchObject({ T: 700_000, U: 600_000 });
  expect(purchasePoint.after.categories.reduce((sum, category) => sum + category.balance, 0)).toBe(100_000);

  const response = await apply(handle, plan);
  expect(response.status).toBe(200);
  expect(handle.sqlite.query("SELECT COUNT(*) AS count FROM journal_entry_budget_allocations WHERE source='depreciation'")
    .get()).toEqual({ count: 0 });
  expect(handle.sqlite.query("SELECT COUNT(*) AS count FROM depreciation_budget_reservations WHERE schedule_id=?")
    .get(handle.scheduleId)).toEqual({ count: 0 });
  const repaired = await snapshot(handle, "2026-01-01");
  expect(repaired).toMatchObject({ T: 700_000, B: 100_000, U: 600_000, D: 0, allocatable: 600_000 });
  const repairedLedgerRows = handle.sqlite.query(`SELECT id,journal_entry_id,account_id,debit,credit,currency
    FROM journal_lines WHERE journal_entry_id=? OR journal_entry_id IN
      (SELECT journal_entry_id FROM depreciation_entries WHERE schedule_id=?) ORDER BY id`)
    .all(handle.purchaseJournalId, handle.scheduleId);
  expect(repairedLedgerRows).toEqual(originalLedgerRows);
});

test("same-timestamp reset needs both a budget action and order, and order changes category balances repeatably", async () => {
  async function applyOrder(order: "before" | "after") {
    const handle = fixture();
    const resetIds = addResetGroup(handle, {
      categories: [1001],
      date: "2026-02-01",
      createdAt: handle.monthlyEntries[1]!.created_at,
      scope: "category",
    });
    const missing = await preview(handle, {
      ...assignedSettings(),
      reset_decisions: [{ reset_log_id: resetIds[0]!, action: "continue" }],
    });
    expect(missing.can_apply).toBe(false);
    expect(missing.boundaries[0]).toMatchObject({
      required_action: "order",
      action_kind: "continue_or_end",
    });

    const config: DepreciationBudgetSettings = {
      ...assignedSettings(),
      reset_decisions: [{ reset_log_id: resetIds[0]!, action: "continue", same_day_order: order }],
    };
    const plan = await preview(handle, config);
    expect(plan.can_apply).toBe(true);
    const response = await apply(handle, plan);
    expect(response.status).toBe(200);
    const first = await snapshot(handle, "2026-02-28");
    const eventCount = handle.sqlite.query("SELECT COUNT(*) AS count FROM budget_adjustment_logs WHERE depreciation_schedule_id=?")
      .get(handle.scheduleId);
    const retry = await apply(handle, plan);
    expect(retry.status).toBe(200);
    expect(handle.sqlite.query("SELECT COUNT(*) AS count FROM budget_adjustment_logs WHERE depreciation_schedule_id=?")
      .get(handle.scheduleId)).toEqual(eventCount);
    expect(await snapshot(handle, "2026-02-28")).toEqual(first);
    return { handle, first };
  }

  const before = await applyOrder("before");
  const after = await applyOrder("after");
  expect(before.first.T).toBe(700_000);
  expect(after.first.T).toBe(700_000);
  expect(before.first.balances).toMatchObject({ 1001: 0, 1002: 80_000 });
  expect(after.first.balances).toMatchObject({ 1001: 10_000, 1002: 80_000 });
});

test("legacy all-category reset needs an explicit scope and never infers scope from category count", async () => {
  const handle = fixture({ extraCategory: false });
  const resetIds = addResetGroup(handle, {
    categories: [1001, 1002],
    date: "2026-02-15",
    createdAt: "2026-02-15 12:00:00",
    scope: null,
  });
  const undecided = await preview(handle, specialSettings());
  expect(undecided.can_apply).toBe(false);
  expect(undecided.boundaries).toHaveLength(1);
  expect(undecided.boundaries[0]).toMatchObject({
    scope: "category",
    scope_confirmation_required: true,
    action_kind: "carry_or_settle",
  });
  expect(undecided.boundaries[0]!.reset_log_id).toBe(resetIds[0]);

  const chosenScope = await preview(handle, {
    ...specialSettings(),
    reset_decisions: [{ reset_log_id: resetIds[0]!, action: "carry", scope: "all" }],
  });
  expect(chosenScope.can_apply).toBe(true);
  expect(chosenScope.boundaries[0]).toMatchObject({ scope: "all", scope_confirmation_required: false });
});

test("legacy special-budget repair carries a virtual deficit through a global reset", async () => {
  const handle = fixture();
  const [resetId] = addResetGroup(handle, {
    date: "2026-02-15",
    createdAt: "2026-02-15 12:00:00",
    scope: "all",
    groupKey: "global-carry",
  });
  const plan = await preview(handle, {
    ...specialSettings(),
    reset_decisions: [{ reset_log_id: resetId!, action: "carry", scope: "all" }],
  });
  expect(plan.can_apply).toBe(true);
  expect(plan.progress.target_amount).toBe(300_000);
  expect(plan.changes.some((change) => change.event.kind === "carry")).toBe(false);
  expect((await apply(handle, plan)).status).toBe(200);

  const schedule = handle.sqlite.query(`SELECT budget_special_category_id AS id FROM depreciation_schedules WHERE id=?`)
    .get(handle.scheduleId) as { id: number };
  expect(schedule.id).toBeGreaterThan(0);
  const current = await snapshot(handle, "2026-02-15");
  expect(current.T).toBe(700_000);
  expect(current.balances[schedule.id]).toBe(-280_000);
  expect(current.balances[1001]).toBe(0);
  expect(current.balances[1002]).toBe(0);
  expect(current).toMatchObject({ B: -280_000, U: 980_000, D: 280_000, allocatable: 700_000 });
  expect(handle.sqlite.query(`SELECT COUNT(*) AS count FROM budget_adjustment_logs
    WHERE depreciation_schedule_id=? AND depreciation_event_key LIKE 'carry:%'`).get(handle.scheduleId))
    .toEqual({ count: 0 });
});

test("settling a legacy virtual special budget at a global reset consumes only its remaining principal", async () => {
  const handle = fixture();
  const [resetId] = addResetGroup(handle, {
    date: "2026-02-15",
    createdAt: "2026-02-15 12:00:00",
    scope: "all",
    groupKey: "global-settlement",
  });
  const plan = await preview(handle, {
    ...specialSettings(),
    reset_decisions: [{
      reset_log_id: resetId!,
      action: "settle",
      settlement_source_category_id: null,
      scope: "all",
    }],
  });
  expect(plan.can_apply).toBe(true);
  expect(plan.progress.target_amount).toBe(300_000);
  expect(plan.progress.reimbursed_amount).toBe(300_000);
  expect(plan.progress.remaining_amount).toBe(0);
  expect(plan.changes.find((change) => change.event.kind === "settlement")?.event.amount).toBe(280_000);
  expect((await apply(handle, plan)).status).toBe(200);

  const schedule = handle.sqlite.query(`SELECT budget_special_category_id AS id FROM depreciation_schedules WHERE id=?`)
    .get(handle.scheduleId) as { id: number };
  const current = await snapshot(handle, "2026-02-15");
  expect(current.T).toBe(700_000);
  expect(current.balances[schedule.id]).toBe(0);
  expect(current).toMatchObject({ B: 0, U: 700_000, D: 0, allocatable: 700_000 });
  expect(handle.sqlite.query(`SELECT SUM(amount) AS amount FROM budget_adjustment_logs
    WHERE depreciation_schedule_id=? AND depreciation_event_key='settlement:reset:${resetId}' AND depreciation_event_side='destination'`)
    .get(handle.scheduleId)).toEqual({ amount: 280_000 });
});

test("fractional USD settlement is accepted and stored in exact minor units", async () => {
  const handle = fixture({ currency: "USD", totalAmount: 100, cashOutflow: 100, months: 100 });
  const plan = await preview(handle, {
    method: "special",
    monthly_source_category_id: 1002,
    settlements: [{ key: "quarter-dollar", date: "2026-02-15", amount: 0.25, source_category_id: null }],
  });
  expect(plan.can_apply).toBe(true);
  expect(plan.progress.target_amount).toBe(100);
  expect(plan.progress.reimbursed_amount).toBe(10.25);
  expect(plan.progress.remaining_amount).toBe(89.75);
  expect((await apply(handle, plan)).status).toBe(200);
  expect(handle.sqlite.query(`SELECT amount,currency FROM budget_adjustment_logs
    WHERE depreciation_schedule_id=? AND depreciation_event_key='settlement:quarter-dollar'
      AND depreciation_event_side='destination'`).get(handle.scheduleId))
    .toEqual({ amount: 25, currency: "USD" });
});

test("concurrent and repeated special apply does not duplicate categories or events; manual edits stale a preview", async () => {
  const handle = fixture();
  const plan = await preview(handle, specialSettings());
  const input = {
    token: plan.token,
    settings: plan.settings,
    confirmed: true,
  };
  const path = `/${handle.scheduleId}/budget/apply`;
  const [first, concurrent] = await Promise.all([
    post(handle, path, input),
    post(handle, path, input),
  ]);
  const concurrentStatuses = [first.status, concurrent.status];
  expect(concurrentStatuses).toContain(200);
  const retry = await post(handle, path, input);
  expect(retry.status).toBe(200);
  expect(handle.sqlite.query("SELECT COUNT(*) AS count FROM budget_categories").get()).toEqual({ count: 4 });
  expect(handle.sqlite.query(`SELECT COUNT(*) AS count,COUNT(DISTINCT depreciation_event_key || ':' || depreciation_event_side) AS distinct_count
    FROM budget_adjustment_logs WHERE depreciation_schedule_id=?`).get(handle.scheduleId))
    .toEqual({ count: 61, distinct_count: 61 });
  expect(handle.sqlite.query(`SELECT COUNT(*) AS count FROM depreciation_budget_revisions
    WHERE schedule_id=? AND action='apply' AND request_key=?`).get(handle.scheduleId, plan.token))
    .toEqual({ count: 1 });
  expect(concurrentStatuses.filter((status) => status !== 200 && status !== 409)).toEqual([]);
});

test("a manual budget mutation makes an earlier repair preview stale", async () => {
  const staleHandle = fixture();
  const stalePlan = await preview(staleHandle, assignedSettings());
  staleHandle.sqlite.query(`UPDATE budget_adjustment_logs SET amount=amount+1
    WHERE budget_category_id=1001 AND adjustment_type='allocation' AND year_month='2025-12'`).run();
  const staleResponse = await apply(staleHandle, stalePlan);
  expect(staleResponse.status).toBe(409);
  expect(await staleResponse.json()).toMatchObject({ error: "stale_preview" });
  expect(staleHandle.sqlite.query(`SELECT COUNT(*) AS count FROM budget_adjustment_logs
    WHERE depreciation_schedule_id=?`).get(staleHandle.scheduleId)).toEqual({ count: 0 });
});
