---
id: budget
titleJa: 予算システム（仮想バケット）
titleEn: Budget System (Virtual Buckets)
---

# Budget System (Virtual Buckets)

Budget categories are virtual buckets layered on top of real cash and bank accounts. The real account balance stays where it is, while the budget system divides that money by purpose, such as free spending, required spending, travel funds, or investing reserves.

## Core Concepts

| Item | Role |
| --- | --- |
| Account | Real ledger item, such as a bank account, card, salary, or food expense |
| Budget category | Virtual purpose-based bucket for cash/deposits |
| Linked expense accounts | Decide which budget is consumed by spending entries |
| Target holding accounts | Describe where you intend to keep the money for a budget |

Create categories from Settings -> Budget Settings. A category can have a group, goal balance, balance cap, overflow destination, linked expense accounts, and target holding accounts.

## Rollover, Reset, And Caps

Regular budgets roll over in full, whether positive or negative. A negative budget is an overrun, so it reduces allocatable money instead of increasing it.

If historical imports or corrections make a balance unrealistic, use Input -> Budget Adjustment -> Budget Reset to bring that category to zero. The Overview page shows a dated reset badge for the month. Balance caps can send excess budget to another category.

## Income Distribution And Adjustments

Income entries can apply a budget filter to distribute the deposit across categories. Filters use fixed, capped, and ratio-split steps. Manual budget adjustments can later increase or decrease individual categories and can include an optional comment.

## Budget Placement

Cash/bank accounts have an "include in allocatable budget source" setting. Only enabled accounts count as allocatable cash and as actual balances in budget placement.

The Budget Placement table appears in Settings -> Budget Settings and Financial Statements -> Trial Balance -> Budget Consistency Check.

| Display | Meaning |
| --- | --- |
| Target | Budget balance intended for the account group |
| Actual | Actual cash/bank balance for the target accounts |
| Difference | Actual - Target |

If one budget links to multiple accounts, or multiple budgets link to one account, related budgets and accounts are merged into one group. When differences exist, hints show how much to move between account groups, or how much budget to add or reduce.

## Transfers And Budget Movement

When entering an account transfer in Simple Input, you can optionally move budget at the same time. Choose a source and destination budget category to record a budget transfer, or leave the destination empty to consume/disappear the budget, such as when investing the reserved money.

The real transfer and the budget movement are separate events. Budget-account links are placement guidance; they do not force income allocation and bank transfers to happen at the same time.

## Budget Consistency

Trial Balance -> Budget Consistency Check detects mismatches between journal entry amounts and saved budget allocation amounts. For multi-line entries and transactions outside budget tracking, the app does not guess budget categories unless explicit allocations are saved.
