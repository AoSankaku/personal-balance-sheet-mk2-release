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

Regular budgets roll over in full, whether positive or negative. A negative budget is an overrun, but it is not counted as a second budget claim because the cash outflow already reflects it. It also does not increase allocatable money.

If historical imports or corrections make a balance unrealistic, use Input -> Budget Adjustment -> Budget Reset to bring that category to zero. The Overview page shows a dated reset badge for the month. Balance caps can send excess budget to another category.

## Income Distribution And Adjustments

Income entries can apply a budget filter to distribute the deposit across categories. Filters use fixed, capped, and ratio-split steps. Manual budget adjustments can later increase or decrease individual categories and can include an optional comment.

## Budget Placement

Cash/bank accounts have an "include in allocatable budget source" setting. Only enabled accounts count as allocatable cash and as actual balances in budget placement.

The Budget Placement table appears in Settings -> Budget Settings and Financial Statements -> Budget -> Budget Consistency Check.

| Display | Meaning |
| --- | --- |
| Target | Budget balance intended for the account group |
| Actual | Actual cash/bank balance for the target accounts |
| Difference | Actual - Target |

Target amounts use the same rule as allocatable money: only positive category balances are added. Negative balances do not reduce targets; they appear separately as unfunded budget overspending. On the Budget page, you can switch between the today and future-income-inclusive bases, and the shortage notification opens the today view.

If one budget links to multiple accounts, or multiple budgets link to one account, related budgets and accounts are merged into one group. When differences exist, hints show how much to move between account groups, or how much budget to add or reduce.

## Transfers And Budget Movement

When entering an account transfer in Simple Input, you can optionally move budget at the same time. Choose a source and destination budget category to record a budget transfer, or leave the destination empty to consume/disappear the budget, such as when investing the reserved money.

The real transfer and the budget movement are separate events. Budget-account links are placement guidance; they do not force income allocation and bank transfers to happen at the same time.

## Budget Consistency {#budget-reconciliation}

Budget -> Budget Consistency Check detects mismatches between journal entry amounts and saved budget allocation amounts. For multi-line entries and transactions outside budget tracking, the app does not guess budget categories unless explicit allocations are saved.

Hover or focus a question icon in the detailed calculation for a brief explanation. Click it, or tap it on a touch screen, to open the matching section of this guide.

Compare the same currency and time basis. Today and the view including future income use different data. The date filter on the journal findings below does not change the overall calculation above.

### Budget cash resources (C) {#budget-resources}

Cash and bank balances included as budget sources, minus liabilities marked for deduction from budget. Card debt is deducted by default. Excluded cash, purchase assets and investments are outside this total. Despite the cash label, this figure is already net of the selected liabilities.

### Net budget balance, including negatives (N) {#budget-net-balance}

The sum of all category balances, including negative ones. If P is positive budget claims and O is unfunded overspending, `N = P − O`.

### Net reconciliation gap (G) {#budget-net-gap}

`G = C − N`. Positive means resources exceed net category balances; negative means category balances exceed resources. Unallocated money, reservations and non-cash expenses can also create a gap, so a nonzero value does not always mean an input error.

### Untracked spending reserve (R) {#budget-reference-reserve}

A field for money separately reserved for untracked spending. It is currently zero; reference records do not consume ordinary budget. Transfers to excluded accounts and reference-record totals do not automatically populate this field.

### Remaining purchase reservation {#budget-purchase-reserve}

The part of a budget installment purchase reservation not yet applied to monthly expense recognition. It has already affected budget balances at purchase, so it is not deducted again from the net reconciliation gap. A reset clears earlier reservations.

### Post-reset monthly non-cash expense offset (D) {#budget-non-cash-offset}

After a reset clears a purchase reservation, monthly expense recognition may reduce budget without another cash payment. This offset prevents that reduction from creating new allocatable money. For each category, add the positive part of “positive cash-basis balance minus positive ordinary balance.” It can differ from the total monthly expenses.

### Reconciliation gap after reserves (A) {#budget-adjusted-gap}

`A = G − R − D`. Deduct the untracked spending reserve and non-cash expense offset from the net gap. Do not deduct the remaining purchase reservation again. If R and D are both zero, A equals G. A remaining negative gap can indicate a resource decrease without a matching budget decrease. A positive gap can include unallocated money.

### Positive budget claims (P) {#budget-positive-claims}

The sum of positive category balances, without offsetting negative categories. This is the funding needed to make all positive budgets usable.

### Already secured (S) {#budget-secured}

`S = P + R + D`. Positive budget claims plus the reserve and non-cash offset.

### Newly allocatable / budget funding shortage (F) {#budget-funding-gap}

`F = C − S = A − O`. A nonnegative result is newly allocatable money; a negative result is a funding shortage. Even when reconciliation is zero, negative categories cause a shortage equal to their overspending. The cash effect of overspending is already in C; do not subtract O from F again.

### Unfunded overspending (O) {#budget-overspending}

The sum of the absolute values of negative category balances. Cover it from another budget or allocate later income. Moving equal amounts between categories leaves N and therefore G unchanged.

### How placement surplus/shortage differs {#budget-placement-gap}

Placement surplus/shortage is cash and bank balances minus the positive budgets, reserves and offsets required at those holding accounts. It does not yet deduct liabilities such as card debt. The after-transfers column projects the proposed placement-balancing transfers; the after-card-debt total also deducts the selected liabilities. Transfers can change individual holding-account gaps, but moving money between included budget accounts does not resolve the overall reconciliation gap.

For example, assume cash of `100,000`, deductible card debt of `10,000`, category balances of `100,000` and `−15,000`, R of `2,000` and D of `3,000`. These are fictional teaching figures; R is currently zero.

| Item | Calculation |
| --- | --- |
| Resources C | 100,000 − 10,000 = 90,000 |
| Net budget N | 100,000 − 15,000 = 85,000 |
| Net gap G | 90,000 − 85,000 = 5,000 |
| Adjusted gap A | 5,000 − 2,000 − 3,000 = 0 |
| Secured S | 100,000 + 2,000 + 3,000 = 105,000 |
| Funding shortage F | 90,000 − 105,000 = −15,000 |
| Total placement gap | 100,000 − 105,000 = −5,000 |

Reconciliation is zero, while overspending is `15,000` and the funding gap is `−15,000`. The placement gap of `−5,000` is before card-debt deduction, so it differs from the funding gap.

### Checking transfers to excluded accounts {#budget-excluded-transfers}

If you receive untracked cash and send the same amount from an included bank account, the household has exchanged money, but budget resources C decrease. Without an equal recorded budget decrease, N stays unchanged and G and A decrease. In Simple Input, choose the paying budget as the budget source and choose disappearance as the budget destination to reduce it. Transfers between categories alone do not reduce total N.

The checker detects insufficient budget reductions on transfers to excluded accounts even when no expense account is present. For compound entries containing both expenses and excluded-account transfers, it takes the saved budget reductions into account. If you intentionally use unallocated money, the resource decrease uses that surplus; a finding does not automatically reduce a category budget.
