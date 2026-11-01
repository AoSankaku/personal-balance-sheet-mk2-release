# Budget indexes and reconciliation read sharing

This implements the first priorities from the November performance audit: remove
duplicate trial-balance reads and repeated full-history searches within budget
calculations. Baseline revision: `29c2637`.

## Changes

Snapshot loading has one tab-change trigger. Concurrent snapshot and card-state
reads share pending requests; completed results do not gain a new cache lifetime.
Writes detach pending reads before and after completion. Request identities and
component/context generations prevent older responses from replacing saved state.
Failed explicit snapshot reloads preserve the previous view.

The trial-balance page and input form reuse card settings/state from AppDataContext.
Drafts seed saved values once per account and subsequently merge newly discovered
months while retaining edits. Removed months stay removed; calendar rollover adds
the new current-month row. Independent review found and resolved regressions in
late settings, rollover, and suppression of edited months before acceptance.

Budget calculations build request-local indexes for reset points, category/month
allocations and reservations, and category account links. Reset lookup uses actual
date ranges, preserving timestamp ordering and funding cutoff semantics. It does
not infer reset dates from the denormalized year_month field. Bucket order remains
the same as source order. Carryover recurrence, caps, accounting rules, and monthly
history prefix replay are unchanged. No schema or persistent cache is introduced.

## Result equivalence and verification

The full computeBudgetSummaries response was compared with original copies of
budget.ts, budgetSummary.ts, and budgetFunding.ts from `29c2637`, running both
against the same disposable synthetic database. Deep equality passed for April,
May through the 20th, and June, with two categories per result (6,534 serialized
bytes). The fixture includes same-day reset timestamps, reference spending,
lending/repayment, legacy depreciation reservations, and depreciation recognized
on the reset date. Comparing live objects also preserves signed-zero checks.

The retained local harness is `worker/.tmp/budgetSummaryParity.ts`; run
`bun run .tmp/budgetSummaryParity.ts` from worker. Original module copies are also
under ignored worker/.tmp. Restoring this harness required fixing a relative
import and removing a cross-run timestamp/JSON comparison; the direct old/new
object comparison then passed. These local artifacts are not part of a fresh clone.

Backend commands from repository root:

```powershell
bun test worker/tests/budgetSummary.test.ts worker/tests/budgetMonthlyDepreciationFunding.test.ts worker/tests/depreciationBudgetReset.test.ts worker/tests/budgetFundingReset.test.ts
bun test worker/tests/depreciationBudgetPreviewSummary.test.ts worker/tests/depreciationBudgetReadPaths.test.ts
```

These pass 51 tests and 367 assertions. Reset lookup tests compare cutoff semantics
with the prior algorithm and instrument source property reads: after indexing 128
reset rows, 100 lookups perform no further source-row reads, with more than a 20x
reduction versus repeated scans including index construction. This is a work-count
measurement, not an end-to-end latency claim.

Frontend targeted coverage comprises 34 tests and 165 assertions across the
following files (unchanged passing suites were reused after the final helper fixes):

```powershell
bun test frontend/tests/inFlightRequestDeduper.test.ts frontend/tests/trialBalanceSharedReads.test.ts frontend/src/lib/creditCardDraftSeeding.test.ts
bun test frontend/tests/trialBalanceAccountIndicators.test.ts frontend/tests/trialBalanceCarryForwardFlow.test.ts frontend/tests/trialBalanceMonthlyTaskFlow.test.ts frontend/tests/trialBalanceNavigationAndUndo.test.ts frontend/tests/trialBalanceStatementCompletion.test.ts
node node_modules/typescript/bin/tsc --noEmit -p frontend/tsconfig.json
```

Frontend TypeScript passes. Worker-wide TypeScript retains unrelated existing
diagnostics; none refer to changed backend production files.

Headless Chrome with an isolated synthetic API verified one initial card-state read,
one card-settings read, no additional read when opening/remounting the input form,
and one snapshot read despite a deliberately delayed response during tab switching.
The final browser run had no page or API errors. The browser harness initially
needed pending route cleanup; API verification was restarted after backend edits
finished to avoid testing an intermediate development version. All task-started
servers and browsers were stopped afterward.

All review findings are resolved. No production data, remote deployment, or push
was involved.
