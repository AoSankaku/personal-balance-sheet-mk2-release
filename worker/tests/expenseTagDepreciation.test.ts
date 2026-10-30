import { expect, test } from "bun:test";
import type { DepreciationBudgetSettings } from "../../shared/depreciationBudget";
import { depreciationRouter } from "../src/routes/depreciation";
import app from "../src/index";
import { createTestD1 } from "./helpers/d1";

function makeFixture(configured: boolean) {
  const fixture = createTestD1();
  const asset = fixture.sqlite.query("INSERT INTO accounts(name,type,category) VALUES('Tag test asset','asset','property') RETURNING id").get<{id:number}>()!.id;
  const cash = fixture.sqlite.query("INSERT INTO accounts(name,type,category) VALUES('Tag test cash','asset','cash') RETURNING id").get<{id:number}>()!.id;
  const expense = fixture.sqlite.query("INSERT INTO accounts(name,type,category) VALUES('Tag test expense','expense','utilities') RETURNING id").get<{id:number}>()!.id;
  const sourceCategory = fixture.sqlite.query("INSERT INTO budget_categories(name,budget_group) VALUES('Tag test source','daily') RETURNING id").get<{id:number}>()!.id;
  const purchaseCategory = fixture.sqlite.query("INSERT INTO budget_categories(name,budget_group) VALUES('Tag test purchase','savings') RETURNING id").get<{id:number}>()!.id;
  const purchaseId = fixture.sqlite.query(`INSERT INTO journal_entries(date,description,created_at)
    VALUES('2026-01-01','Tag depreciation purchase','2026-01-01 09:00:00') RETURNING id`).get<{id:number}>()!.id;
  fixture.sqlite.query(`INSERT INTO journal_lines(journal_entry_id,account_id,debit,credit,currency)
    VALUES(?,?,300000,0,'JPY'),(?,?,0,300000,'JPY')`).run(purchaseId, asset, purchaseId, cash);
  const settings: DepreciationBudgetSettings = {
    method: "assigned", purchase_category_id: purchaseCategory,
    monthly_source_category_id: sourceCategory,
  };
  const scheduleId = fixture.sqlite.query(`INSERT INTO depreciation_schedules
    (source_journal_entry_id,asset_account_id,expense_account_id,total_amount,months,start_date,description,
     budget_method,budget_settings,budget_target_amount,budget_currency)
    VALUES(?,?,?,300000,3,'2026-01-01','Tag depreciation',?,?,300000,'JPY') RETURNING id`)
    .get<{id:number}>(purchaseId, asset, expense, configured ? "assigned" : null, configured ? JSON.stringify(settings) : null)!.id;
  const oldMonthId = fixture.sqlite.query(`INSERT INTO journal_entries(date,description,created_at)
    VALUES('2026-01-01','Tag depreciation 予算分割振替（減価償却） (1/3ヶ月)','2026-01-01 10:00:00') RETURNING id`).get<{id:number}>()!.id;
  fixture.sqlite.query("INSERT INTO depreciation_entries(schedule_id,journal_entry_id,month_number) VALUES(?,?,1)").run(scheduleId, oldMonthId);
  fixture.sqlite.query(`INSERT INTO journal_lines(journal_entry_id,account_id,debit,credit,currency)
    VALUES(?,?,100000,0,'JPY'),(?,?,0,100000,'JPY')`).run(oldMonthId, expense, oldMonthId, asset);
  const tagId = fixture.sqlite.query("INSERT INTO expense_tags(name) VALUES('旅行') RETURNING id").get<{id:number}>()!.id;
  fixture.sqlite.query("INSERT INTO journal_entry_expense_tags(journal_entry_id,tag_id) VALUES(?,?)").run(oldMonthId, tagId);
  fixture.sqlite.query("INSERT INTO journal_entry_tag_amounts(journal_entry_id,currency,amount) VALUES(?,'JPY',76543)").run(oldMonthId);
  return { fixture, scheduleId, oldMonthId };
}

async function patchDescription(f: ReturnType<typeof makeFixture>, description: string) {
  return depreciationRouter.request(`/${f.scheduleId}`, {
    method: "PATCH", headers: { "content-type": "application/json" },
    body: JSON.stringify({ description }),
  }, { DB: f.fixture.DB });
}

function activeMonthlyTags(f: ReturnType<typeof makeFixture>) {
  return f.fixture.sqlite.query(`SELECT d.month_number, t.name, a.currency, a.amount
    FROM depreciation_entries d
    LEFT JOIN journal_entry_expense_tags jet ON jet.journal_entry_id=d.journal_entry_id
    LEFT JOIN expense_tags t ON t.id=jet.tag_id
    LEFT JOIN journal_entry_tag_amounts a ON a.journal_entry_id=d.journal_entry_id
    WHERE d.schedule_id=? ORDER BY d.month_number`).all<{month_number:number;name:string|null;currency:string|null;amount:number|null}>(f.scheduleId);
}

async function verifyMetadataSurvivesEdit(configured: boolean) {
  const f = makeFixture(configured);
  try {
    const response = await patchDescription(f, "Updated depreciation description");
    expect(response.status).toBe(200);
    const current = activeMonthlyTags(f);
    expect(current.filter((row) => row.month_number === 1)).toEqual([
      { month_number: 1, name: "旅行", currency: "JPY", amount: 76543 },
    ]);
    expect(current.filter((row) => row.month_number > 1).every((row) => row.name === null && row.amount === null)).toBe(true);
    expect(f.fixture.sqlite.query("SELECT id FROM journal_entries WHERE id=?").get(f.oldMonthId)).toBeNull();
    const history = JSON.parse(f.fixture.sqlite.query("SELECT snapshot FROM journal_deletion_candidates WHERE original_journal_entry_id=?")
      .get<{snapshot:string}>(f.oldMonthId)!.snapshot) as { expense_tags: { name:string }[]; tag_expense_amounts: {currency:string;amount:number}[] };
    expect(history.expense_tags).toEqual([{ id: expect.any(Number), name: "旅行" }]);
    expect(history.tag_expense_amounts).toEqual([{ id: expect.any(Number), journal_entry_id: f.oldMonthId, currency: "JPY", amount: 76543 }]);
  } finally {
    f.fixture.close();
  }
}

test("preserves tags and manual amounts by month number through a legacy depreciation edit", () =>
  verifyMetadataSurvivesEdit(false));

test("preserves tags and manual amounts by month number through a configured depreciation edit", () =>
  verifyMetadataSurvivesEdit(true));

async function verifyFailedRebuildRollsBack(configured: boolean) {
  const f = makeFixture(configured);
  try {
    const headerCount = f.fixture.sqlite.query("SELECT COUNT(*) AS count FROM journal_entries").get<{count:number}>()!.count;
    const historyCount = f.fixture.sqlite.query("SELECT COUNT(*) AS count FROM journal_deletion_candidates").get<{count:number}>()!.count;
    f.fixture.sqlite.exec(`CREATE TRIGGER reject_regenerated_depreciation_lines
      BEFORE INSERT ON journal_lines
      WHEN NEW.journal_entry_id IN (
        SELECT id FROM journal_entries WHERE description LIKE 'Rollback depreciation %'
      )
      BEGIN SELECT RAISE(ABORT,'test rejection of regenerated monthly lines'); END`);

    const response = await app.request(`/api/depreciation/${f.scheduleId}`, {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ description: "Rollback depreciation" }),
    }, { DB: f.fixture.DB });
    expect(response.status).toBe(500);
    expect(f.fixture.sqlite.query("SELECT COUNT(*) AS count FROM journal_entries").get<{count:number}>()!.count).toBe(headerCount);
    expect(f.fixture.sqlite.query("SELECT COUNT(*) AS count FROM journal_deletion_candidates").get<{count:number}>()!.count).toBe(historyCount);
    expect(f.fixture.sqlite.query(`SELECT description FROM depreciation_schedules WHERE id=?`)
      .get<{description:string}>(f.scheduleId)?.description).toBe("Tag depreciation");
    expect(activeMonthlyTags(f).filter((row) => row.month_number === 1)).toEqual([
      { month_number: 1, name: "旅行", currency: "JPY", amount: 76543 },
    ]);
    expect(f.fixture.sqlite.query("SELECT id FROM journal_entries WHERE id=?").get(f.oldMonthId)).not.toBeNull();
  } finally {
    f.fixture.close();
  }
}

test("rolls back legacy schedule regeneration when new monthly lines fail", () =>
  verifyFailedRebuildRollsBack(false));

test("rolls back configured schedule regeneration when new monthly lines fail", () =>
  verifyFailedRebuildRollsBack(true));
