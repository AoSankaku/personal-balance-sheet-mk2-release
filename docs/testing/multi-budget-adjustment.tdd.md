# Multi-budget adjustment editor

## Intended behavior

The budget-adjustment tab lists all active budgets, lets the user select several, and can narrow the list to that selection without losing changes. Each row shows the selected date's balance before adjustment, a signed delta, and the authoritative balance after adjustment. The footer separates the signed delta total from projected allocatable money. A −10,000 / B +8,000 totals −2,000; a balanced total is also valid.

Allocatable money is recomputed from positive claims, reserves and non-cash offsets, with dated cash/liability resources. It is not approximated by subtracting the delta sum. Caps, overflow destinations, historical resets and negative category balances remain effective.

All ordinary adjustments share one date and note and save atomically. A revision-bound preview prevents stale or duplicate application. Existing depreciation-aware resets remain a separate mode using the original single-reset API.

## RED evidence

- `9e83b67` — `test: capture multi-budget adjustment editor requirements`: the existing form failed both new presentation tests because it only edited one category and lacked before/after and total displays.
- `fafe266` — `test: define multi-budget adjustment API`: five initial API tests failed because preview and batch routes did not exist (404).
- During review, a 100-row request reproduced a D1 101-bind failure under the actual 100-parameter limit before the query was corrected. A regression also covers unsafe intermediate integer sums.

## GREEN implementation

- `POST /api/budget/allocations/preview` appends hypothetical logs to the full stored history and recomputes before/after summaries without writing data.
- `POST /api/budget/allocations/batch` validates every input, verifies a timestamp/request/state-bound token, then inserts all ordinary adjustment logs in one revision-guarded transaction.
- Validation covers active category IDs, date, enabled currency, precision, safe amounts/totals, duplicates and the supported 100-budget limit.
- Drafts are separated by currency. A shared pending/completion store prevents a currency or route remount from reusing successfully applied deltas. A response that may have been lost after commit locks the draft for reconciliation instead of silently issuing a fresh save token.
- Reset drafts cannot submit as ordinary adjustments after mode changes. Desktop balances have accessible before/after labels; mobile rows stack without page overflow.
- All six supported languages include new labels and updated budget-guide instructions.

## Verification

- Frontend TypeScript: passed (`bun x tsc --noEmit -p frontend/tsconfig.json`).
- Frontend targeted tests: 26 passed, 0 failed. This includes 15 arithmetic/draft/save-state cases, 2 editor-render cases, 4 locale checks and 5 existing guide checks. New adjustment-input arithmetic has 100% function/line coverage.
- Worker targeted tests: 7 batch API cases passed, including negative claims/caps, non-cash offsets, historical reset/date/currency behavior, validation, replay rejection, stale guard at the write boundary, 100-row preview/save and rollback on a later insert failure.
- Existing Worker adjustment-log tests (6) and depreciation-reset tests (15): passed. Worker dry-run build: passed.
- Worker-wide TypeScript currently reports 26 diagnostics. A separate export of the unchanged source produced byte-identical diagnostics; none are in the changed budget route. This task does not repair unrelated existing typing issues.
- `frontend/tests/budgetAdjustmentEditor.browser.mjs` passed against Vite and the disposable local API in `worker/tests/helpers/runBudgetAdjustmentFixture.ts`. It checks selection/filtering, exact totals and funding, read-only preview, tab/currency drafts, failed preview recovery, stale-save recovery, one atomic save, delayed-save currency round-trip, lost-response duplicate prevention, currency cents, responsive desktop/mobile layout, and reset-mode remount protection.
- Headless browser verification used synthetic data only. Task-started servers were stopped. No production database or financial records were changed; no migration is required.
