# Missing budget reductions on excluded cash transfers

Journeys were derived from the report that a bank-to-excluded-cash transfer could
leave a reconciliation gap without appearing in the suspicious-entry list. The
existing expense/income checks did not examine that transfer shape.

The checker now compares the selected currency's net budget-resource decrease
with its net receipt into excluded, non-depreciable cash accounts. For a pure
cash/card transfer, it reports any portion not covered by an actual net budget
decrease in saved consumption allocations or linked adjustment records. A
category-to-category transfer has no net decrease and cannot hide the gap.

| Guarantee | Evidence |
| --- | --- |
| Bank/card transfers with no or partial reduction are reported with their amount, recorded reduction, and missing amount | `frontend/src/lib/cashTransferBudgetCheck.test.ts` |
| Recorded reductions, including the configured business budget category, are counted without applying the expense-only category exclusion | Same test file |
| Currency scope, net excluded-cash movement, reference/reset records, and adjustment direction are respected | Same test file |
| Ordinary cash transfers, card repayments, excluded cards, opening balances, loans, depreciation, ambiguous lines, and the earlier compound-expense fix retain their behavior | Same file plus existing consistency tests |
| Input data is not mutated | Deep equality assertion in the regression test and a separate ignored real-data reproducer |

RED command:

```text
bun test frontend/src/lib/cashTransferBudgetCheck.test.ts
```

Result: **2 passed, 21 failed** before implementation. In particular, the existing
checker returned no reason for the unrecorded bank/card transfers. The new detail
field was also absent. Checkpoint: `ef7b860`.

GREEN/coverage command:

```text
bun test frontend/src/lib/cashTransferBudgetCheck.test.ts frontend/src/lib/budgetConsistency.test.ts frontend/src/lib/expenseBudgetConsistency.test.ts frontend/tests/tt-budget-check.test.ts frontend/src/components/tt/ttIncomeBudgetCheck.test.ts frontend/tests/i18nTranslations.test.ts --coverage --coverage-reporter=text
```

Result: **84 passed, 0 failed, 7,543 assertions**. `budgetConsistency.ts` had 100%
function and 98.11% line coverage. The existing compound-expense helper retained
100% function and line coverage. Frontend TypeScript passed. The new warning has
translations in all six supported locales, and the table shows actual transfer
amounts and saved reductions rather than zero expense/income totals.

A reproducer using the previously retrieved, ignored production rows reported
the remaining unrecorded transfer and did not report either already-corrected
transfer. Real descriptions, amounts, identifiers, and financial data remain in
ignored local files. No database write, migration, server, or browser was needed.
