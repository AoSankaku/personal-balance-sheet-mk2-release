import { afterEach, expect, test } from "bun:test";
import type { BudgetCategorySummary } from "../../shared/types";
import { createDb } from "../src/db";
import { computeBudgetSummaryForDate } from "../src/routes/budget";
import { createTestD1 } from "./helpers/d1";

type MonthlyFundingFields = {
  depreciation_funding_out?: number;
  depreciation_funding_in?: number;
};

const databases: ReturnType<typeof createTestD1>[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

function fixture() {
  const database = createTestD1();
  databases.push(database);
  database.sqlite.exec(`
    INSERT INTO accounts(id,name,type,category) VALUES
      (9001,'Asset','asset','property'),(9002,'Depreciation','expense','other');
    INSERT INTO budget_categories(id,name,budget_group) VALUES
      (1001,'Source A','Travel'),(1002,'Source B','Travel'),(1003,'Destination','Travel');
    INSERT INTO journal_entries(id,date,description,created_at)
      VALUES(9100,'2026-01-01','Depreciable purchase','2026-01-01 09:00:00');
    INSERT INTO depreciation_schedules(id,source_journal_entry_id,asset_account_id,expense_account_id,
      total_amount,months,start_date,budget_method,budget_target_amount,budget_currency)
      VALUES(9200,9100,9001,9002,10000,10,'2026-01-01','assigned',10000,'JPY');
  `);
  return database;
}

function addLog(
  database: ReturnType<typeof fixture>,
  row: {
    category: number;
    amount: number;
    date: string;
    createdAt?: string;
    adjustmentType?: string;
    scheduleId?: number | null;
    eventKey?: string | null;
    eventSide?: "source" | "destination" | null;
    currency?: string;
  },
) {
  database.sqlite
    .query(`INSERT INTO budget_adjustment_logs(
      budget_category_id,year_month,amount,currency,date,created_at,adjustment_type,
      depreciation_schedule_id,depreciation_event_key,depreciation_event_side
    ) VALUES(?,?,?,?,?,?,?,?,?,?)`)
    .run(
      row.category,
      row.date.slice(0, 7),
      row.amount,
      row.currency ?? "JPY",
      row.date,
      row.createdAt ?? `${row.date} 09:00:00`,
      row.adjustmentType ?? "transfer",
      row.scheduleId === undefined ? 9200 : row.scheduleId,
      row.eventKey ?? null,
      row.eventSide ?? null,
    );
}

function category(
  summary: Awaited<ReturnType<typeof computeBudgetSummaryForDate>>,
  id: number,
) {
  return summary.categories.find((row) => row.category.id === id)! as
    BudgetCategorySummary & MonthlyFundingFields;
}

test("managed monthly funding is reported after resets without changing budget balances", async () => {
  const database = fixture();
  try {
    // A's prior balance and a same-day movement before reset are outside the
    // current post-reset period. The later monthly events include both legacy
    // and split keys, multiple sources in one group, and an unallocated receipt.
    addLog(database, { category: 1001, amount: 1000, date: "2026-08-01", adjustmentType: "allocation", scheduleId: null });
    addLog(database, { category: 1001, amount: -70, date: "2026-08-10", createdAt: "2026-08-10 11:00:00", eventKey: "monthly:0:category:1001", eventSide: "source" });
    addLog(database, { category: 1003, amount: 70, date: "2026-08-10", createdAt: "2026-08-10 11:00:00", eventKey: "monthly:0:category:1001", eventSide: "destination" });
    addLog(database, { category: 1001, amount: -930, date: "2026-08-10", createdAt: "2026-08-10 12:00:00", adjustmentType: "reset", scheduleId: null });
    addLog(database, { category: 1001, amount: -125, date: "2026-08-10", createdAt: "2026-08-10 13:00:00", eventKey: "monthly:1:category:1001", eventSide: "source" });
    addLog(database, { category: 1003, amount: 125, date: "2026-08-10", createdAt: "2026-08-10 13:00:00", eventKey: "monthly:1:category:1001", eventSide: "destination" });
    addLog(database, { category: 1001, amount: -55, date: "2026-08-11", eventKey: "monthly:2:category:1001", eventSide: "source" });
    addLog(database, { category: 1003, amount: 55, date: "2026-08-11", eventKey: "monthly:2:category:1001", eventSide: "destination" });
    addLog(database, { category: 1003, amount: 20, date: "2026-08-11", eventKey: "monthly:3:unallocated", eventSide: "destination" });
    addLog(database, { category: 1001, amount: -5, date: "2026-08-12", createdAt: "2026-08-12 09:00:00", eventKey: "monthly:4:category:1001", eventSide: "source" });
    addLog(database, { category: 1003, amount: 5, date: "2026-08-12", createdAt: "2026-08-12 09:00:00", eventKey: "monthly:4:category:1001", eventSide: "destination" });
    addLog(database, { category: 1001, amount: -10, date: "2026-08-12", createdAt: "2026-08-12 10:00:00", eventKey: "monthly:5:category:1001", eventSide: "source" });
    addLog(database, { category: 1003, amount: 10, date: "2026-08-12", createdAt: "2026-08-12 10:00:00", eventKey: "monthly:5:category:1001", eventSide: "destination" });
    addLog(database, { category: 1001, amount: -999, date: "2026-08-13", eventKey: "monthly:6:category:1001", eventSide: "source" });
    addLog(database, { category: 1003, amount: 999, date: "2026-08-13", eventKey: "monthly:6:category:1001", eventSide: "destination" });

    addLog(database, { category: 1002, amount: 500, date: "2026-08-01", adjustmentType: "allocation", scheduleId: null });
    addLog(database, { category: 1002, amount: -40, date: "2026-08-11", eventKey: "monthly:7:category:1002", eventSide: "source" });
    addLog(database, { category: 1003, amount: 40, date: "2026-08-11", eventKey: "monthly:7:category:1002", eventSide: "destination" });
    addLog(database, { category: 1003, amount: 100, date: "2026-08-01", adjustmentType: "allocation", scheduleId: null });

    // These rows still participate in the existing adjustment math. They must
    // not be classified as managed monthly depreciation funding.
    addLog(database, { category: 1002, amount: -600, date: "2026-08-13", eventKey: "purchase", eventSide: "source" });
    addLog(database, { category: 1002, amount: -700, date: "2026-08-13", eventKey: "routing:2026-08-13", eventSide: "source" });
    addLog(database, { category: 1002, amount: -800, date: "2026-08-13", eventKey: "settlement:2026-08-13", eventSide: "source" });
    addLog(database, { category: 1002, amount: -900, date: "2026-08-13", adjustmentType: "allocation", eventKey: "monthly:8:category:1002", eventSide: "source" });
    addLog(database, { category: 1002, amount: -1000, date: "2026-08-13", scheduleId: null, eventKey: "monthly:9:category:1002", eventSide: "source" });
    addLog(database, { category: 1002, amount: -1100, date: "2026-08-13", eventKey: "monthlyish:10", eventSide: "source" });
    addLog(database, { category: 1002, amount: -1200, date: "2026-08-13", eventKey: "monthly:11:category:1002" });

    const db = createDb({ DB: database.DB });
    const fullPeriod = await computeBudgetSummaryForDate(db, "2026-08-31", "JPY");
    expect(category(fullPeriod, 1001)).toMatchObject({
      total_budget: -1194,
      spent: 0,
      available: -1194,
    });
    expect(category(fullPeriod, 1002)).toMatchObject({
      total_budget: -5840,
      spent: 0,
      available: -5840,
    });
    expect(category(fullPeriod, 1003)).toMatchObject({
      total_budget: 1424,
      spent: 0,
      available: 1424,
    });
    expect(category(fullPeriod, 1001)).toMatchObject({
      depreciation_funding_out: 1194,
      depreciation_funding_in: 0,
    });
    expect(category(fullPeriod, 1002).depreciation_funding_out).toBe(40);
    expect(category(fullPeriod, 1002).depreciation_funding_in).toBe(0);
    expect(category(fullPeriod, 1003)).toMatchObject({
      depreciation_funding_out: 0,
      depreciation_funding_in: 1324,
    });

    // An as-of day clamps visible rows by date; a through timestamp additionally
    // resolves rows on the cutoff day in the same way as the existing summary.
    const asOf = await computeBudgetSummaryForDate(db, "2026-08-11", "JPY");
    expect(category(asOf, 1001).depreciation_funding_out).toBe(180);
    expect(category(asOf, 1003).depreciation_funding_in).toBe(310);
    const through = await computeBudgetSummaryForDate(db, "2026-08-31", "JPY", {
      through: { date: "2026-08-12", created_at: "2026-08-12 09:30:00" },
    });
    expect(category(through, 1001)).toMatchObject({
      total_budget: -185,
      spent: 0,
      available: -185,
    });
    expect(category(through, 1003)).toMatchObject({
      total_budget: 415,
      spent: 0,
      available: 415,
    });
    expect(category(through, 1001).depreciation_funding_out).toBe(185);
    expect(category(through, 1003).depreciation_funding_in).toBe(315);
  } finally {
    database.close();
  }
});

test("legacy depreciation allocations remain spent without managed monthly funding", async () => {
  const database = fixture();
  try {
    database.sqlite.exec(`
      UPDATE depreciation_schedules SET budget_method=NULL WHERE id=9200;
      INSERT INTO journal_entries(id,date,description,created_at)
        VALUES(9201,'2026-09-15','Legacy depreciation','2026-09-15 09:00:00');
      INSERT INTO journal_lines(journal_entry_id,account_id,debit,credit) VALUES
        (9201,9002,500,0),(9201,9001,0,500);
      INSERT INTO depreciation_entries(schedule_id,journal_entry_id,month_number)
        VALUES(9200,9201,9);
      INSERT INTO journal_entry_budget_allocations(journal_entry_id,budget_category_id,amount,currency)
        VALUES(9201,1001,-500,'JPY');
    `);

    const summary = await computeBudgetSummaryForDate(createDb({ DB: database.DB }), "2026-09-30", "JPY");
    expect(category(summary, 1001)).toMatchObject({
      spent: 500,
      depreciation_spent: 500,
      available: -500,
    });
    expect(category(summary, 1001).depreciation_funding_out).toBe(0);
    expect(category(summary, 1001).depreciation_funding_in).toBe(0);
  } finally {
    database.close();
  }
});

test("USD monthly depreciation funding preserves fractional currency precision", async () => {
  const database = fixture();
  try {
    addLog(database, { category: 1001, amount: 500, date: "2026-09-01", adjustmentType: "allocation", scheduleId: null, currency: "USD" });
    addLog(database, { category: 1001, amount: -123, date: "2026-09-02", eventKey: "monthly:1", eventSide: "source", currency: "USD" });
    addLog(database, { category: 1003, amount: 123, date: "2026-09-02", eventKey: "monthly:1", eventSide: "destination", currency: "USD" });

    const summary = await computeBudgetSummaryForDate(createDb({ DB: database.DB }), "2026-09-30", "USD");
    expect(category(summary, 1001)).toMatchObject({
      total_budget: 3.77,
      spent: 0,
      available: 3.77,
    });
    expect(category(summary, 1001).depreciation_funding_out).toBe(1.23);
    expect(category(summary, 1003).depreciation_funding_in).toBe(1.23);
  } finally {
    database.close();
  }
});
