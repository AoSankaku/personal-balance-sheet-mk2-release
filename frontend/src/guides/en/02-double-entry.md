---
id: double-entry
titleJa: 複式簿記とシンプル入力
titleEn: Double-Entry & Simple Input
---

# Double-Entry & Simple Input

All ledger data in this app is stored as double-entry journal entries. In double-entry bookkeeping, each transaction records both "what increased" and "what decreased." This makes it possible to later verify the relationships between assets, liabilities, net worth, income, and expenses.

You do not need to think about debits and credits for everyday entry. In simple entry, you choose the transaction type, amount, and counterpart account, and the app creates the matching journal entry.

## Entries Created By Simple Input

| Input type | Example | What the app does internally |
| --- | --- | --- |
| Expense | Pay for food from a bank account | Increases expense and decreases the payment asset |
| Income | Salary is deposited into a bank account | Increases asset and increases income |
| Transfer | Move money from savings to a brokerage account | Decreases one asset and increases another asset |
| Borrow | A friend pays on your behalf | Increases an expense or asset, and increases a liability |
| Repay | Pay back borrowed money | Decreases a liability and decreases the payment asset |
| Lend | Lend money to someone | Increases a lending asset and decreases cash/deposits |
| Collect | Receive money that was lent out | Increases cash/deposits and decreases the lending asset |

## Why You Can Use It Without Knowing Double-Entry

Simple entry asks for real-life information. For an expense, you choose what you spent money on and where you paid from. For income, you choose what kind of income it was and where it was deposited. The app determines debit and credit directions from the account types.

On the Ledger page, the same journal entries can be viewed in both simple and double-entry formats. If you are not used to bookkeeping, it is enough to review the simple view and only open the double-entry view when balances look wrong or you need to handle a special transaction.

## When To Use Multi-Line Entries

Use multi-line entries when one transaction involves three or more accounts. Examples include deposits with fees deducted, transactions that mix business advances and personal expenses, or sales where you want to explicitly record a gain or loss.

For multi-line entries, total debits and total credits must match. Unbalanced transactions cannot be saved. This is the core rule that keeps the ledger consistent.

## Debit and Credit Rules

In double-entry bookkeeping, every account type increases on one side and decreases on the other.

| Account type | Increases on | Decreases on |
| --- | --- | --- |
| Asset | Debit | Credit |
| Liability | Credit | Debit |
| Equity (net worth) | Credit | Debit |
| Income | Credit | Debit |
| Expense | Debit | Credit |

Once you know this table, you can determine journal directions on your own. For example, "paid for food from a bank account" means the bank account is an asset, so it goes on the credit side. The food expense increases, so it goes on the debit side. Together, those two lines form one complete journal entry.

## How To Read Journal Entries

On the Ledger page, double-entry view shows each line as a debit or credit detail.

| Side | Meaning |
| --- | --- |
| Debit (left) | The account increased (asset, expense) or decreased (liability, equity, income) |
| Credit (right) | The account increased (liability, equity, income) or decreased (asset, expense) |

In one journal entry, total debits must always equal total credits. Entries where they do not match cannot be saved.

## Account Types and Their Roles

| Type | Examples | Description |
| --- | --- | --- |
| Asset | Bank account, cash, lending, crypto | Things you own |
| Liability | Credit card, loan, borrowing | Amounts you owe to others |
| Equity | Opening balance | Net worth (assets minus liabilities) |
| Income | Salary, interest income, sale gains | Reasons money increases |
| Expense | Food, utilities, depreciation | Reasons money decreases |

Equity is calculated as assets minus liabilities, so it is rarely entered directly. The opening balance input is the main use.

## Notes When Editing

You can edit journal entries from the Ledger page. Entries created through simple input can be converted back to the original input format when possible. Monthly depreciation entries and entries that include special system accounts may break related calculations if edited directly. In those cases, it is safer to edit the source input or settings instead.

When balances do not match, check the difference against actual balances on the Trial Balance page before deleting entries based on guesswork. Fixing entries after identifying the cause makes it easier to understand the impact on budgets and reports.
