---
id: depreciation
titleJa: 擬似的な減価償却と予算分散
titleEn: Pseudo-Depreciation & Budget Spreading
---

# Pseudo-Depreciation & Budget Spreading

Depreciation in this app is not intended for tax filing or formal corporate accounting. It is a household finance feature for spreading the burden of a large purchase across multiple months.

For example, if you buy a 120,000 yen appliance in January, a normal household ledger would show a large January expense. In practice, you may want to think of it as consuming 10,000 yen per month over one year. Pseudo-depreciation is for that situation.

## What Happens

When you enable depreciation while entering an expense, the app creates two types of records:

| Record | Content |
| --- | --- |
| Purchase record | Decreases the payment asset and increases the depreciable asset |
| Monthly records | Gradually decreases the asset and records an expense each month |

Cash decreases at the time of purchase, but the effect on expenses and budgets is spread by month. On the balance sheet, the portion not yet expensed remains as an asset.

## Setup Before Use

1. In Settings, create the asset account you want to depreciate.
2. Enable depreciation for that asset account.
3. Prepare an expense account to use for depreciation expense.
4. When entering an expense on the Input page, enable depreciation.

In period-based entry, specify how many months the total amount should be split across. In monthly amount entry, specify how much should be expensed each month. If rounding is required, monthly amounts are adjusted so the total still matches.

## Effect On Budgets

With a normal expense, the budget is consumed in the month of payment. With depreciation, the budget impact appears as monthly depreciation expense.

This makes it possible to smooth out large annual purchases or supplies used for several months as part of monthly living costs. The goal is to separate the payment month from the usage period in a way that matches how the household actually feels the cost.

## Suitable Expenses

| Suitable items | Reason |
| --- | --- |
| Appliances, furniture, PCs, smartphones | Used over several months or years |
| Annual subscriptions | Effectively used every month |
| Expensive hobby or work equipment | Avoids distorting the budget only in the purchase month |
| One-time spending for lifestyle improvements | Benefits span multiple months |

For food, daily goods, and other items consumed within the same month, use normal expense entry.

## Editing And Deleting Notes

When you edit the purchase entry that created depreciation, the monthly depreciation entries are recalculated. Editing only a monthly entry can make it inconsistent with the overall schedule.

If you need to change the details, edit from the original purchase entry when possible. If it is no longer needed, delete the related depreciation schedule and re-enter it as a normal expense if necessary.

## Difference From Tax Depreciation

This feature is pseudo expense spreading for household management. It does not automatically determine useful life, depreciation method, business-use ratio, or tax treatment. Assets that require tax handling should be managed separately according to formal books and tax rules.
