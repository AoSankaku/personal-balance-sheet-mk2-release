---
id: depreciation
titleJa: 予算分割振替
titleEn: Budget installment transfers
---

# Budget installment transfers

This feature records a purchase cost as monthly expenses and manages its budget impact over time. At purchase, the amount is first recorded in the selected “Purchase asset account”; it is then transferred to the “Expense account” over the configured period. The remaining balance in the purchase asset account is the plan's unexpensed amount, not the purchase's market value or tax value.

For example, a 120,000 yen computer spread over 12 months is expensed from the purchase asset account to the expense account at about 10,000 yen per month. If monthly budget replenishment is enabled, funds are also transferred from regular budget categories to the purchase budget each month.

## Budget methods

| Method | Purchase-time and monthly budget handling |
| --- | --- |
| Assigned budget | The selected purchase budget is reduced at purchase. Each month, it is replenished by transfers from the budget sources configured by percentage. |
| Special budget | A dedicated special budget starts with a negative balance. Each month, it is replenished by transfers from the configured budget sources. |
| Unallocated | The budget-eligible purchase amount is funded from unallocated funds at purchase. Monthly expense entries continue, but there are no monthly budget replenishments. |

## Entry and budget ratios

On the Input page, enable “Budget installment transfers,” select the “Purchase asset account” and “Expense account,” and set the period by “Transfer months” or “Monthly transfer amount.” For methods with monthly budget replenishment, the “Budget shares” editor starts with the expense account's budget ratios. Each saved plan keeps a snapshot of its shares, so later changes to the expense account do not change existing plans.

Edit each budget category's share directly or adjust it by entering an amount for the representative month shown in the editor. Entering an amount sets its share based on that representative transfer; actual transfers may vary by month, such as when the first month is prorated. “Restore expense account defaults” reloads the expense account's current budget ratios.

If named category shares total less than 100%, the remainder is treated as a transfer from unallocated funds, and saving requires explicit confirmation. Shares above 100% cannot be saved. Transfers from unallocated funds reduce those funds while replenishing the purchase budget.

Remainders are distributed in the currency's smallest unit using the largest-remainder method. Ties go by ascending budget category ID, with unallocated funds last. For each month, the budget source total matches the amount replenished to the purchase budget.

## Editing and deleting

Changing the purchase entry or plan settings can affect monthly expense entries and budget replenishments. Make changes from the original purchase input or plan settings; do not edit generated monthly entries or budget records directly. Delete the related plan when it is no longer needed.

## Difference from depreciation

This feature spreads a purchase cost into monthly expenses for household management and manages the monthly budget impact through transfers between budget categories. The remaining amount in the purchase asset account is the plan's unexpensed balance. The feature does not determine an asset's market value, useful life, depreciation method, business-use ratio, or tax treatment. Handle any formal accounting or tax treatment separately under the applicable rules.