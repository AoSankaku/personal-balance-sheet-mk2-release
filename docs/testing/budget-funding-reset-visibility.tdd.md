# Budget funding reset visibility TDD evidence

## User journey

As a user who reset the budget, I want the budget consistency check to hide
loan/lending funding history at or before the reset boundary, so that the
screen reflects the new budget starting point.

## Production-data diagnosis

A read-only query against the remote D1 database confirmed:

- all eight current budget categories have a latest JPY reset date of
  `2026-05-01`;
- loan/lending entries dated before that boundary still exist, as expected;
- zero-impact entries among them have no persisted funding rows.

The red missing-funding check already used the reset boundary. The neutral
zero-impact funding-history list did not, so pre-reset entries remained
visible.

## RED

Command:

`bun test tests/budgetFundingCompleteness.test.ts tests/tt-budget-check.test.ts`

Result before the production change: 8 passed, 2 failed, 1 module error.
The new boundary helper export was missing and the budget-check component did
not apply it to neutral funding history.

## GREEN

The neutral funding-history list now waits for reset logs and applies the same
date-and-input-timestamp boundary as the missing-funding check.

Targeted command:

`bun test tests/budgetFundingCompleteness.test.ts tests/tt-budget-check.test.ts`

Result: 16 passed, 0 failed.

Full command from the repository root:

`bun test --coverage frontend/tests frontend/src`

Result: 384 passed, 0 failed, 6,552 assertions. Overall coverage was 91.93%
functions and 92.54% lines. `budgetFundingCompleteness.ts` coverage was 88.00%
functions and 85.90% lines.

Build:

`bun run build` from `frontend`

Result: TypeScript and Vite production build passed.

## Guarantees

| Guarantee | Test |
| --- | --- |
| Entries dated before the reset are excluded | `budgetFundingCompleteness.test.ts` |
| Entries on the reset date but entered before the reset are excluded | `budgetFundingCompleteness.test.ts` |
| Entries entered after the reset boundary remain visible | `budgetFundingCompleteness.test.ts` |
| The neutral history UI uses the boundary and waits for reset logs | `tt-budget-check.test.ts` |

