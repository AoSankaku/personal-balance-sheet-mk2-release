# Expense budget checks with excluded cash transfers

Journeys were derived from the request to preserve saved budget allocations while
removing false warnings for compound expenses that also move cash outside budget
management. Committed fixtures use synthetic accounts and amounts.

The ordinary expense comparison remains valid. An additional accepted comparison
requires each currency's saved expense allocation to equal both the expense plus
the **net** receipt into excluded cash and the journal's budget-resource decrease.
References and separate loan, transfer, or business advance classifications retain
their existing handling. No journal, allocation, API, or database write is changed.

| Guarantee | Evidence |
| --- | --- |
| Qualifying credit-card and cash-funded compound entries no longer warn | `frontend/src/lib/expenseBudgetConsistency.test.ts` |
| One-unit errors, eligible receiving cash, excluded funding sources, and inconsistent journal amounts still warn | Same test file |
| Multiple excluded-cash movements use their net amount and currencies cannot justify each other's discrepancies | Same test file |
| Reference allocations, separate transfers/funding, business advances, and ordinary expense-only allocations retain their treatment | Same test file plus existing budget and income check tests |
| Checking an entry leaves its saved data intact | Deep equality assertion in the compound-entry regression test |

RED command:

```text
bun test frontend/src/lib/expenseBudgetConsistency.test.ts
```

Result before the fix: **19 passed, 4 failed**. The failures were the qualifying
card-funded, cash-funded, net-movement, and multiple-currency compound entries.
Checkpoint: `2498523` (`test: reproduce excluded cash transfer budget warnings`).

GREEN and coverage command:

```text
bun test frontend/src/lib/expenseBudgetConsistency.test.ts frontend/src/lib/budgetConsistency.test.ts frontend/tests/tt-budget-check.test.ts frontend/src/components/tt/ttIncomeBudgetCheck.test.ts --coverage --coverage-reporter=text
```

Result: **57 passed, 0 failed, 89 assertions**. The new
`expenseBudgetConsistency.ts` helper has **100% function and line coverage**;
`budgetConsistency.ts` has 100% function and 97.74% line coverage in this run.

`bun x tsc --noEmit -p frontend/tsconfig.json` passed. A local read-only reproducer
using previously retrieved production rows also returned no warning and verified
that the input entry was unchanged. Financial rows remain in ignored local files.

No server, browser, migration, or production update was needed: this change is a
pure frontend warning predicate, exercised through the existing checker entry
point. Existing warning labels and allocation totals are unchanged.
