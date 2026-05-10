---
id: trial-balance
titleJa: 試算表とクレジットカード残高確認
titleEn: Trial Balance & Credit Card Reconciliation
---

# Trial Balance & Credit Card Reconciliation

The Trial Balance page checks whether book balances match actual balances. Open it from Financial Statements -> Trial Balance.

## What It Can Do

| Tab | Purpose |
| --- | --- |
| Actual Input | Enter actual account balances or card usage amounts |
| Error Verification | Compare actual values with book balances |
| Unknown Funds | Temporarily absorb unexplained differences |
| Budget Consistency Check | Review journal-budget mismatches and budget placement |

## Accounts And Credit Cards

After saving actual balances for bank accounts, cash, liabilities, or card usage, Error Verification shows book value, actual value, and difference. If a difference exists, check same-amount candidates, recent entries, wrong dates, duplicates, refunds, and transfers entered in the wrong direction.

Credit cards often differ because usage date, cutoff date, confirmation date, withdrawal date, and billing month are separate. When the statement is confirmed, save the amount for the relevant payment month and compare it with ledger usage.

## Budget Consistency Check

The budget consistency check verifies whether journal entry income/expense amounts match saved budget allocation amounts. It detects entries with missing allocations or mismatched amounts.

For multi-line entries and transactions outside budget tracking, the app does not guess budget categories unless explicit allocations are saved. Edit the entry from the Ledger if needed, or use Budget Adjustment to correct only the current budget.

This tab also shows the Budget Placement table. It compares target holding accounts configured on budget categories with actual cash/bank balances, then shows hints for how much to move between account groups or how much budget to add or reduce.
