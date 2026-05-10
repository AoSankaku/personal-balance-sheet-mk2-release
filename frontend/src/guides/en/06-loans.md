---
id: loans
titleJa: 貸し借り管理
titleEn: Loan Management
---

# Loan Management

This app can manage personal lending, borrowing, and loans separately from expenses. Money you lend to someone is recorded as an asset, and money you borrow from someone is recorded as a liability.

If lending or borrowing is treated as an expense, the real situation becomes hard to see later when repayment or collection happens. Loan management lets you separately review uncollected amounts, unpaid amounts, and completed history.

## Short-Term vs. Long-Term

| Type | Use |
| --- | --- |
| Short-term lending | Temporary advances, small loans to friends, and similar items |
| Long-term lending | Loans with a long repayment period, or loans where you want to track balance by counterparty |
| Short-term borrowing | Amounts temporarily paid on your behalf |
| Long-term borrowing | Loans, installment repayment, or borrowing where you want to track balance by counterparty |

Short-term lending and borrowing are managed as individual unresolved transactions, and you can choose which transaction is settled when repaying or collecting. Long-term lending and borrowing are managed mainly by account balance.

## How To Enter

On the Input page, choose Loan/Repay in simple entry. There are four directions:

| Direction | Meaning |
| --- | --- |
| Borrow | You borrowed money, or someone paid on your behalf |
| Repay | You repaid money you owed |
| Lend | You lent money, or paid on someone else's behalf |
| Collect | You received money that was owed to you |

For borrowing or lending, choose the target loan account and the counterpart asset or expense account. For repayment or collection, select the transaction being settled so the app knows which loan was resolved.

## Repayments Or Collections With Differences

The repayment or collection amount may not exactly match the original amount because of fees, discounts, exchange differences, rounding, gifts, or similar reasons.

In that case, choose a difference account to record the difference as a gain or loss. For example, receiving more than the amount you lent is income, while receiving less is an expense.

## Loan Management Page

Financial Statements -> Loan Management lists lending and borrowing. The page is split into short-term lending, long-term lending, short-term borrowing, and long-term borrowing.

Unresolved short-term items are shown as cards. Completed short-term items and long-term items whose balance reached zero are stored in a completed accordion.

From each card, pressing "Enter from here" opens the loan input flow on the Input page. For long-term lending or borrowing, you can also force an item to be treated as completed when it is actually finished but hard to determine from ledger balance alone.

## Closing a Loan

Short-term lending or borrowing moves to completed once a repayment or collection entry is recorded. If the amount exactly matches the original, select the target transaction and settle it — that is all it takes to mark it complete.

Long-term lending or borrowing is automatically treated as complete when the balance reaches zero. If the balance does not reach zero even though repayment is actually done, use "Force complete" on the Loan Management page. However, it is recommended to first check why the balance does not match (for example, a missed entry or an input error) before forcing completion.

## Handling Differences in Repayment or Collection

The repayment or collection amount may not exactly match the original.

| Case | How to handle |
| --- | --- |
| Received more than you lent | Record the difference as income (e.g., miscellaneous income, interest income) |
| Received less than you lent | Record the difference as an expense (e.g., miscellaneous loss) |
| Repaid less than you borrowed (debt forgiven) | Record the difference as income (debt forgiveness gain) |
| Repaid more than you borrowed (interest or fees) | Record the difference as an expense (interest expense, fees) |

In every case, the goal is to bring the loan account balance to zero. You can choose the difference account in the loan entry form without having to build a multi-line entry manually.

## Handling Bad Debt

When a receivable is no longer expected to be collected, write it off as bad debt expense.

Steps:
1. In Settings, create a Bad Debt expense account if one does not exist yet.
2. Use a multi-line entry to credit the lending account (decrease the asset) and debit the bad debt account (increase the expense).
3. On the Loan Management page, use Force complete to move the item to completed.

If only part of the amount can be collected, combine an entry for the cash you did receive with a second entry that writes off the remainder as bad debt.

## How To Create Accounts

If you have many temporary advances, using shared accounts such as Short-term Lending and Short-term Borrowing is often easier. If you want to track a balance for a specific person or loan over a long period, create separate long-term accounts such as "Loan to A" or "Home Loan."

Lending and borrowing are not household expenses themselves. Money moves in or out, but because it is expected to be returned or must be repaid, it is treated as an asset or liability. If it ultimately will not be returned, or no longer needs to be repaid, clear it as a loss/gain or miscellaneous loss/gain.
