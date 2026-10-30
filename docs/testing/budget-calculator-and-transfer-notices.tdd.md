# Budget distribution calculator and pending placement notices

Journeys were derived from the calculator request and the explicit follow-up to fix reconciliation notices in parallel. The user chose an optional Apply button that copies estimates into the current budget fields without recording a journal entry. No plan document was supplied.

## Behavior

- The compound-entry form opens a budget distribution calculator. Scratch values live only while the calculator is open. Cancel changes nothing; Apply replaces only the relevant draft budget fields. Normal Add/Save remains the only journal-posting action.
- Account mode uses an expense/income account, amount and debit/credit side. Expense ratios remain literal; incomplete ratios leave a remainder. Income requires an explicit filter or destination category. The user may explicitly assign any remainder to a category.
- Current-entry mode calculates expense/refund allocations from expense accounts and income capacity from the existing shared boundary calculation. A receipt with bank 19,800 + fee 200 / income 20,000 has an expense target of −200 and income target of +20,000.
- Rounding uses each currency's minor units, including odd yen, USD, BTC and SKR. Reference-only spending from excluded cash is shown separately. Standard investment sales retain the existing income/principal treatment in normal submission.
- Invalid/unbalanced/unknown, ambiguous excluded-source, unsupported noncash and loan-principal cases cannot be applied automatically. Loan funding stays in the existing funding fields. Completed income-transfer allocations remain protected.
- Reconciliation notices now include current computed placement transfers without saved income requirements, along with uncovered saved tasks and unresolved requirements. Counts include both affected accounts, respect currency and deferral, and avoid counting covered resolved requirements twice.
- Pending placement work does not alter actual/book balances, snapshot arithmetic, or clean-snapshot status. The notice explicitly identifies current work separately from the selected historical snapshot. Loading/failure states remain visible, including when there is no snapshot.
- New copy is present in all six supported locales.

## RED / GREEN evidence

| Guarantee | Target | RED evidence | GREEN evidence |
| --- | --- | --- | --- |
| Scratch calculator UI and exact allocation display | `frontend/src/components/BudgetDistributionCalculator.test.tsx` | Component module missing | Rendering tests pass for odd yen and separate income/fee targets |
| Signed ratios, explicit remainder, precision, income filters, scope and principal handling | `frontend/src/lib/budgetDistributionCalculator.test.ts` | Engine module missing | Fourteen focused tests pass |
| Expense-only placement proposals appear in reconciliation | `frontend/src/lib/pendingReconciliationTransfers.test.ts` | Summary helper absent | Generated transfers, account counts, deferral, currency and fallback tests pass |
| Underfunded unresolved income tasks do not disappear | Same summary tests | Covered-ID filtering returned zero tasks | Unresolved IDs remain visible with no proposed transfer and alongside a distinct partial placement transfer |
| Reference split follows excluded-cash direction | Engine tests and `worker/tests/budgetDistributionCalculatorParity.test.ts` | Engine showed reference-only for an unrelated excluded-account inflow; two API-parity tests failed | Signed source gate matches the actual API, including the reverse refund case |
| Suggested allocations are actually submit-compatible | Same API-parity tests | Mixed expense/refund with partial excluded funding was incorrectly applicable | Unsupported mixed-sign/excluded-source combination is blocked; the real API rejection is covered |
| Unused selected accounts do not affect calculation | Engine tests | A zero-valued investment row blocked an ordinary expense | Validated zero lines are excluded from semantic classification |
| UI transfer to draft is explicit and nonpersistent | Headless Chromium acceptance | New acceptance coverage | Cancel leaves the fields unchanged; Apply copies values; no mutation requests occur during calculation or application |

## Verification

Targeted command from the repository root:

```powershell
bun test --coverage frontend/src/lib/budgetDistributionCalculator.test.ts frontend/src/components/BudgetDistributionCalculator.test.tsx frontend/src/lib/pendingReconciliationTransfers.test.ts frontend/tests/trialBalanceAccountIndicators.test.ts worker/tests/budgetDistributionCalculatorParity.test.ts frontend/tests/simpleEntryBudgetDistribution.test.ts frontend/src/components/MultiLineIncomeBudget.test.tsx frontend/tests/budgetPlacementReconciliationUi.test.ts frontend/src/lib/budgetPlacementDeferral.test.ts frontend/src/lib/incomeTransferPlacementTasks.test.ts frontend/tests/i18nTranslations.test.ts frontend/tests/trialBalanceCarryForwardFlow.test.ts
node node_modules/typescript/bin/tsc --noEmit -p frontend/tsconfig.json
```

- The targeted run passed 74 of 75 tests. The remaining existing localization test timed out because it reparsed all six large YAML files inside every key iteration. It now parses each locale once, retains all assertions, and additionally checks the new notice copy. Its targeted rerun passed all four tests in that file. Every selected test now has passing evidence; no application change was needed for that timeout.
- Frontend TypeScript passes.
- Calculator engine function/line coverage: 100%/98.57%. Pending-transfer summary: 100%/100%. These are targeted helper results, not project-wide coverage claims.
- Eight real API/SQLite cases validate fee/income separation, active/reference splits, expenses/refunds, excluded income, deductible-card income, excluded-cash direction and refusal of unsupported suggestions.
- Independent reviews found the unresolved-task omission and three calculator edge cases. Regressions reproduced each issue before correction; re-reviews found no remaining concrete concerns.

Headless verification used `.tmp/budgetCalculatorBrowser.mjs` and `.tmp/budgetCalculatorQaServer.ts`. It checked an isolation marker and routed all application API traffic to a loopback-only, in-memory synthetic database. It verified 965 → 483/482, discard/reset behavior, explicit draft application, fee 200/income 20,000, filter allocation, explicit income destination, preservation of expense fields, zero mutation requests, pending placement warnings on both accounts with matching balances, and preview failure/retry. A 390px mobile screenshot was visually inspected. No browser JavaScript errors occurred.

The browser was closed and both Vite and the synthetic API were stopped. No existing local or production financial records were used or changed.

## Delivery

RED checkpoint: `a7018ce`. The implementation commit contains the GREEN code, additional regression coverage and this report. No database migration or production deployment was performed; no commits were pushed.
