import { expect, test } from "bun:test";
import type { CreditCardSettings, CreditCardStateEntry } from "@balance-sheet/shared";
import { formatCreditCardPaymentLabel, getCreditCardWindowMeta } from "../../frontend/src/components/tt/ttUtils";
import { getConfirmedCsvCreditCardState } from "../../frontend/src/lib/creditCardStatementCompletion";
import { parseCSVFile } from "../../frontend/src/utils/csvParser";
import { trialBalanceRouter } from "../src/routes/trialBalance";
import { createTestD1 } from "./helpers/d1";

test("confirmed CSV survives trial-balance persistence under its closing month", async () => {
  const fixture = createTestD1();
  try {
    fixture.sqlite.exec(`
      INSERT INTO accounts(id,name,type,category) VALUES
        (1,'amazonマスター','liability','credit_card'),
        (2,'Other card','liability','credit_card');
      INSERT INTO actual_balance_credit_card_state(account_id,payment_month,amount,status)
        VALUES(1,'2026-07',123,'paid'),(2,'2026-08',456,'confirmed');
    `);
    // Shift-JIS "様" header followed by SMBC confirmed rows across a closing day.
    const file = new File([
      new Uint8Array([0x97, 0x6c]),
      "\r\n2026/07/16,Shop,1000,1\r\n2026/08/15,Shop,2000,1\r\n2026/08/15,Refund,-500,1",
    ], "statement.csv");
    const parsed = await parseCSVFile(file);
    expect(parsed.format).toBe("smbc-confirmed");
    expect(parsed.transactions).toHaveLength(3);
    const settings: CreditCardSettings = {
      id: 1, account_id: 1, closing_day: 15, confirmation_day: 20,
      withdrawal_day: 27, billing_offset_months: 0, created_at: "2026-01-01T00:00:00Z",
    };
    const state = getConfirmedCsvCreditCardState({ ...parsed, settings });
    expect(state).toMatchObject({ payment_month: "2026-08", amount: 2500 });

    const response = await trialBalanceRouter.request("/credit-card-state", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(state),
    }, { DB: fixture.DB });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ payment_month: "2026-08", amount: 2500 });

    const saved = await trialBalanceRouter.request("/credit-card-state", {}, { DB: fixture.DB });
    expect(saved.status).toBe(200);
    const rows = await saved.json() as CreditCardStateEntry[];
    expect(rows).toHaveLength(3);
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ account_id: 1, payment_month: "2026-07", amount: 123, status: "paid" }),
      expect.objectContaining({ account_id: 2, payment_month: "2026-08", amount: 456, status: "confirmed" }),
    ]));
    const imported = rows.find(row => row.account_id === 1 && row.payment_month === "2026-08")!;
    expect(formatCreditCardPaymentLabel(imported.payment_month, settings, "ja")).toBe("2026-09支払分");
    expect(getCreditCardWindowMeta("2026-09-20", imported.payment_month, settings, "en").period?.end).toBe("2026-08-15");
    expect(rows.some(row => row.account_id === 1 && row.payment_month === "2026-09")).toBe(false);
  } finally {
    fixture.close();
  }
});
