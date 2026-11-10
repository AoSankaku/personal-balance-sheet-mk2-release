import { afterEach, describe, expect, test } from "bun:test";

import { createTestD1 } from "./helpers/d1";
import { accountsRouter } from "../src/routes/accounts";

const databases: ReturnType<typeof createTestD1>[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

function fixture() {
  const database = createTestD1();
  databases.push(database);
  database.sqlite.exec(`
    INSERT INTO accounts (id,name,type,category) VALUES
      (1001,'Bank','asset','cash'),
      (1002,'Loan','liability','long_term_loan'),
      (1003,'Opening','equity','opening_balance'),
      (1004,'Salary','income','salary'),
      (1005,'Food','expense','food'),
      (1006,'Empty asset','asset','property');
    INSERT INTO account_completions (account_id) VALUES (1006);
    INSERT INTO enabled_currencies (code, decimal_places) VALUES ('USD', 2);
    INSERT INTO journal_entries (id,date,description) VALUES
      (2001,'2025-12-31','opening'),
      (2002,'2026-01-15','loan'),
      (2003,'2026-10-02','income'),
      (2004,'2026-10-02','spend'),
      (2005,'2026-11-01','future');
    INSERT INTO journal_lines (journal_entry_id,account_id,debit,credit,currency) VALUES
      (2001,1001,10000,0,'JPY'), (2001,1003,0,10000,'JPY'),
      (2002,1001,5000,0,'JPY'), (2002,1002,0,5000,'JPY'),
      (2003,1004,0,12345,'USD'), (2003,1003,12345,0,'USD'),
      (2004,1005,675,0,'USD'), (2004,1001,0,675,'USD'),
      (2005,1001,3000,0,'JPY'), (2005,1002,0,3000,'JPY');
  `);
  return database;
}

async function balancesAt(database: ReturnType<typeof createTestD1>, asOf: string) {
  const response = await accountsRouter.request(`/?as_of=${asOf}`, {}, { DB: database.DB });
  expect(response.status).toBe(200);
  const accounts = await response.json() as Array<{
    id: number;
    type: string;
    balances: Record<string, number>;
    balance: number;
    is_completed: boolean;
  }>;
  return new Map(accounts.map((account) => [account.id, account]));
}

describe("account balance reads", () => {
  test("preserves debit and credit normal balances by currency and historical cutoff", async () => {
    const database = fixture();

    const opening = await balancesAt(database, "2025-12-31");
    expect(opening.get(1001)?.balances).toEqual({ JPY: 10000 });
    expect(opening.get(1002)?.balances).toEqual({});

    const current = await balancesAt(database, "2026-10-02");
    expect(current.get(1001)?.balances).toEqual({ JPY: 15000, USD: -6.75 });
    expect(current.get(1002)?.balances).toEqual({ JPY: 5000 });
    expect(current.get(1003)?.balances).toEqual({ JPY: 10000, USD: -123.45 });
    expect(current.get(1004)?.balances).toEqual({ USD: 123.45 });
    expect(current.get(1005)?.balances).toEqual({ USD: 6.75 });
    expect(current.get(1006)).toMatchObject({ balance: 0, balances: {}, is_completed: true });

    const future = await balancesAt(database, "2026-11-01");
    expect(future.get(1001)?.balances).toEqual({ JPY: 18000, USD: -6.75 });
    expect(future.get(1002)?.balances).toEqual({ JPY: 8000 });
  });

});
