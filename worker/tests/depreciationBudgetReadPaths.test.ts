import { describe, expect, test } from "bun:test";
import { depreciationRouter } from "../src/routes/depreciation";
import { createTestD1 } from "./helpers/d1";

describe("depreciation read paths respect D1 parameter limits", () => {
  test("list and report handle 120 monthly journal IDs with a 100-parameter cap", async () => {
    const harness = createTestD1({ maxParameters: 100 });
    try {
      const assetId = harness.sqlite
        .query("INSERT INTO accounts(name,type,category) VALUES('Asset','asset','property') RETURNING id")
        .get<{ id: number }>()!.id;
      const expenseId = harness.sqlite
        .query("INSERT INTO accounts(name,type,category) VALUES('Depreciation','expense','utilities') RETURNING id")
        .get<{ id: number }>()!.id;
      const purchaseJournalId = harness.sqlite
        .query("INSERT INTO journal_entries(date,description,created_at) VALUES('2026-01-01','Purchase','2026-01-01 09:00:00') RETURNING id")
        .get<{ id: number }>()!.id;
      const scheduleId = harness.sqlite
        .query(`INSERT INTO depreciation_schedules
          (source_journal_entry_id,asset_account_id,expense_account_id,total_amount,months,start_date,description)
          VALUES(?,?,?,1200000,120,'2026-01-01','Long plan') RETURNING id`)
        .get<{ id: number }>(purchaseJournalId, assetId, expenseId)!.id;

      for (let month = 1; month <= 120; month++) {
        const monthOfYear = ((month - 1) % 12) + 1;
        const date = `2026-${String(monthOfYear).padStart(2, "0")}-01`;
        const journalId = harness.sqlite
          .query("INSERT INTO journal_entries(date,description,created_at) VALUES(?,?,?) RETURNING id")
          .get<{ id: number }>(date, `Depreciation ${month}`, `${date} 12:00:00`)!.id;
        harness.sqlite
          .query("INSERT INTO depreciation_entries(schedule_id,journal_entry_id,month_number) VALUES(?,?,?)")
          .run(scheduleId, journalId, month);
        harness.sqlite
          .query(`INSERT INTO journal_lines(journal_entry_id,account_id,debit,credit,currency)
            VALUES(?,?,10000,0,'JPY'),(?,?,0,10000,'JPY')`)
          .run(journalId, expenseId, journalId, assetId);
      }

      const env = { DB: harness.DB };
      const listResponse = await depreciationRouter.request("/", {}, env);
      expect(listResponse.status).toBe(200);
      const listed = await listResponse.json() as Array<{ id: number; monthly_amounts: number[]; entry_dates: string[] }>;
      expect(listed).toHaveLength(1);
      expect(listed[0]!.id).toBe(scheduleId);
      expect(listed[0]!.monthly_amounts).toHaveLength(120);
      expect(listed[0]!.entry_dates).toHaveLength(120);

      const reportResponse = await depreciationRouter.request("/report?year=2026", {}, env);
      expect(reportResponse.status).toBe(200);
      const report = await reportResponse.json() as {
        total_depreciation: number;
        entries: Array<{ schedule_id: number; amount_in_period: number }>;
      };
      expect(report.total_depreciation).toBe(1200000);
      expect(report.entries).toMatchObject([
        { schedule_id: scheduleId, amount_in_period: 1200000 },
      ]);
    } finally {
      harness.close();
    }
  });
});
