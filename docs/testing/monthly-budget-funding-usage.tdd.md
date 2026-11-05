# Monthly depreciation funding in budget usage

The user requested that monthly funding of repaired depreciation plans count visibly as budget usage, without deducting it from the budget balance twice. Reference records must be shown separately rather than described as a portion of a zero usage amount.

## Reporting contract

The API's existing `spent`, `total_budget`, `available`, carryover, cash-basis values, and reconciliation calculations remain unchanged. Two optional category fields report managed monthly funding transfers out and in. They use the existing log query, currency decoding, month/as-of visibility, and reset ordering; no schema migration or extra database query is required.

Only managed `transfer` events with a monthly event key and the matching source/destination sign enter the new fields. This includes split-source and unallocated receipts. Purchases, routing changes, settlements, ordinary transfers, and legacy depreciation already included in `spent` are not counted again.

For presentation:

```text
budget usage = spent + monthly funding out
budget before usage = total_budget + monthly funding out
remaining balance = API available (unchanged)
```

The same amount is restored to the display denominator and added to displayed usage. Funding received and reference records are separate details, not extra usage. These definitions describe budget movements rather than P&L expenses. The hero excludes savings; the savings-inclusive strip uses all categories. Categories with a nonpositive display budget do not show a misleading zero usage percentage. Older cached API responses default missing reporting fields to zero.

## RED / GREEN evidence

The shared RED checkpoint is `f647699`. The frontend helper and detail component were absent, and the three backend integration tests failed because the additional fields were absent after the existing financial assertions had passed.

| Guarantee | Verification |
| --- | --- |
| Screenshot amounts, incoming/outgoing distinction, legacy no-double-count, references/refunds, negative budgets, currency decimals, immutable balances, savings scope, older payloads | Seven frontend helper tests pass. |
| Explicit spending/funding/received labels, reference amounts outside usage, no redundant empty breakdown | Three server-rendered component tests pass. The initial mock required the language provider export; this test-harness correction did not change application behavior. |
| Actual D1 summary, resets and same-day ordering, as-of/through cutoffs, multiple sources, unallocated receipts, event exclusions, legacy depreciation, USD precision | Three integration tests pass with real migrations and disposable in-memory databases. Existing budget values are asserted before the new reporting fields. |
| Existing summary, monthly-source, reset, overview-loading and legacy-presentation behavior | 81 related tests pass (65 backend and 16 frontend). Combined unique targeted coverage is 94 tests. |
| Frontend type safety and localization | Frontend TypeScript passes; all new copy exists in all six locales. |

Commands from the repository root:

```powershell
node node_modules/typescript/bin/tsc --noEmit -p frontend/tsconfig.json
bun test frontend/src/lib/budgetUsagePresentation.test.ts frontend/src/components/BudgetUsageDetails.test.tsx frontend/tests/overviewSummaryLoading.test.ts frontend/src/lib/depreciationBudgetPresentation.test.ts
bun test --coverage frontend/src/lib/budgetUsagePresentation.test.ts frontend/src/components/BudgetUsageDetails.test.tsx
bun test worker/tests/budgetMonthlyDepreciationFunding.test.ts
bun test worker/tests/budgetSummary.test.ts worker/tests/depreciationBudgetMonthlySources.test.ts worker/tests/depreciationBudgetReset.test.ts
```

Worker-wide TypeScript still reports unrelated dependency and source diagnostics; none refer to the three production files changed in this task. The targeted Worker integration tests pass.

## Browser acceptance and review

Headless Chrome checked the actual Overview UI against an isolated synthetic API contract. The synthetic screenshot scenario yields usage 5,248, budget before usage 21,688, and unchanged remaining balance 16,440. Free spending shows funding out 2,362 and unchanged balance -53,439; necessary spending shows 2,886 and unchanged balance 69,879. The all-category strip reports funding received separately and preserves its original balance. This is synthetic validation, not a claim that the production transactions were inspected.

The browser check also passed at a 390-pixel viewport and with USD funding 1.23, balance 3.77, and pre-usage budget 5.00. No API writes or browser errors occurred. A test expectation was adjusted for the currency symbol between a minus sign and its digits. The helper scripts and logs are local under `.tmp/`; Vite, the synthetic API, and the headless browser are stopped after verification.

Independent review found no remaining concrete issues in the period/reset filtering, reporting algebra, legacy handling, cap compatibility, cache fallback, or Overview wiring. No production data, migrations, or deployment were changed.
