# Current budget placement reconciliation

User journeys were derived from the request to include payments made from a different
holding account in transfer tasks, while keeping intentional budget overspending.

## Intended behavior

- Calculate a current-date, currency-specific transfer plan from cash balances and
  positive budget claims, including reservations already used by placement reporting.
- Keep unavoidable funding shortages with the affected overspending group where
  possible. Transfers conserve money and do not change any budget allocation.
- Reserve unplaced budgets, exclude non-budget assets, and never overdraw a source.
- Show calculated transfers instead of duplicate saved gross-income transfer tasks.
- Preserve saved income provenance and show verifiable cross-account expense entries.
- Show current differences, differences after transfers, and the total after deducting
  budget liabilities. Liability attribution to an individual holding group is not assumed.
- Recompute and validate the preview before recording actual transfers. Concurrent
  edits or repeated submissions must not create duplicate transfers.

## TDD evidence

| Guarantee | Test | Evidence |
| --- | --- | --- |
| Income and expense placement offsets are reconciled while overspending stays unchanged | `shared/budgetPlacementPlan.test.ts` | Initial RED: 6 executed tests failed because `generateBudgetPlacementPlan` was missing. GREEN: targeted placement tests passed. |
| Transfer previews use selected-currency balances even when an aggregate balance exists | `shared/budgetPlacementPlan.test.ts` | RED: projected JPY balance was 510 instead of 10 for a USD-only account. GREEN after using the same currency-specific balance reader as placement. |
| Conservation, no source overdraft, currency precision, excluded assets, unplaced reserves, and a stable completed plan | `shared/budgetPlacementPlan.test.ts` | Includes deterministic varied-state checks and a second calculation after applying transfers. |

Commands used:

```text
bun test shared/budgetPlacementPlan.test.ts
bun test shared/budgetPlacementPlan.test.ts frontend/tests/budgetPlacement.test.ts frontend/src/lib/budgetPlacement.test.ts --coverage
```

The second command passed 18 tests and 447 assertions. The shared placement module
had 97.52% line coverage. Financial snapshot checks use ignored local artifacts and
are not included in the repository.

## API and interface verification

The API reproducer initially received HTTP 404 for the missing endpoints. Integration
tests now cover actual multi-transfer journal rows, undo, duplicate/stale rejection,
future and excluded requirements, currency scope, partial/zero funding, and D1 bind
limits. Further regression cases reproduced invalid multi-row SQL and fractional
target-ratio signature differences before the fixes. Legacy signed expense rows
and the true latest reset boundary (including same-day timestamps) are also covered.

The UI folds covered income requirements into the placement plan, retains their
deferral controls, and keeps wholly deferred groups out of actionable counts.
Confirmation freezes the reviewed token and amounts. A generation guard prevents
old currency requests from replacing newer results.

Final targeted command:

```text
bun test shared/budgetPlacementPlan.test.ts frontend/tests/budgetPlacement.test.ts frontend/src/lib/budgetPlacement.test.ts frontend/src/lib/incomeTransferPlacementTasks.test.ts frontend/src/lib/budgetPlacementDeferral.test.ts frontend/tests/budgetPlacementReconciliationUi.test.ts frontend/tests/incomeTransferTasks.test.ts worker/tests/budgetPlacementReconciliation.test.ts worker/tests/incomeTransferRequirements.test.ts worker/tests/incomeTransferDeferral.test.ts worker/tests/incomeTransferSchedulingFlow.test.ts
```

Result: **64 tests passed, 0 failed, 880 assertions**. Frontend TypeScript and the
Vite production build passed. Worker TypeScript retained the same 112 baseline
diagnostics, with no added diagnostic after normalizing source line positions.

Headless Chromium checks used an isolated in-memory database and the production
frontend bundle, with external browser requests blocked. At 1440px and 390px they
verified calculated tasks, both adjusted columns, historical expense evidence,
recording, and absence of stale gross-income tasks afterward. A further check
verified postponement, resume, stale-token rejection without duplicate records,
immediate completion-history refresh, and undo restoring the plan. No browser page
errors occurred. The temporary QA server was stopped afterward.

No production data was changed and no migration is required. Only unambiguous
expense/cash entries are presented as historical evidence; ambiguous compound
entries are omitted rather than assigned a speculative payment source. Historical
evidence is explicitly labelled as history, because it may already be reimbursed.
