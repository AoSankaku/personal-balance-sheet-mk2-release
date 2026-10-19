import { expect, test } from "bun:test";
import { createTestD1 } from "./helpers/d1";
import { createDb } from "../src/db";
import { budgetAdjustmentLogs } from "../src/db/schema";
import { computeBudgetSummaryForDate } from "../src/routes/budget";

test("hypothetical correction uses the normal summary across every reset without writing data", async () => {
  const h = createTestD1();
  try {
    h.sqlite.exec(`INSERT INTO budget_categories(id,name) VALUES(1001,'Savings'),(1002,'Living');
      INSERT INTO budget_adjustment_logs(budget_category_id,year_month,amount,currency,date,created_at,adjustment_type) VALUES
      (1001,'2026-01',1000,'JPY','2026-01-01','2026-01-01 00:00:00','allocation'),
      (1002,'2026-01',300,'JPY','2026-01-01','2026-01-01 00:00:00','allocation'),
      (1001,'2026-02',-1000,'JPY','2026-02-15','2026-02-15 12:00:00','reset'),
      (1002,'2026-03',-300,'JPY','2026-03-15','2026-03-15 12:00:00','reset'),
      (1002,'2026-03',50,'JPY','2026-03-15','2026-03-15 13:00:00','allocation');`);
    const db = createDb({DB:h.DB});
    const oldLogs = await db.select().from(budgetAdjustmentLogs);
    const events = [
      {category:1001,amount:-300,date:'2026-01-02'},
      ...['2026-01-03','2026-02-01','2026-03-01','2026-04-01'].flatMap(date =>
        [{category:1001,amount:10,date},{category:1002,amount:-10,date}]),
    ].map((event,index) => ({...oldLogs[0]!,id:100+index,budget_category_id:event.category,
      amount:event.amount,date:event.date,created_at:`${event.date} 09:00:00`,year_month:event.date.slice(0,7),adjustment_type:'transfer'}));
    const before = await computeBudgetSummaryForDate(db,'2026-04-01','JPY');
    const after = await computeBudgetSummaryForDate(db,'2026-04-01','JPY',{adjustmentLogs:[...oldLogs,...events]});
    expect(before.categories.map(row=>row.available)).toEqual([50,0]);
    expect(after.categories.find(row=>row.category.id===1001)!.available).toBe(20);
    expect(after.categories.find(row=>row.category.id===1002)!.available).toBe(40);
    const boundary = await computeBudgetSummaryForDate(db,'2026-03-15','JPY',{
      adjustmentLogs:[...oldLogs,...events],through:{date:'2026-03-15',created_at:'2026-03-15 12:00:00'}});
    expect(boundary.categories.find(row=>row.category.id===1002)!.available).toBe(0);
    expect(h.sqlite.query('SELECT count(*) AS n FROM budget_adjustment_logs').get()).toEqual({n:5});
  } finally { h.close(); }
});
