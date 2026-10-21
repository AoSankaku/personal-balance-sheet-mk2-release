# Compound income and investment sale budget allocation

## Accepted behavior

- A compound receipt saves income allocation through income budget adjustments, separately from expense consumption.
- An investment sale can allocate the full received proceeds. The recognized gain is income allocation; the recovered principal is an allocation from returned unallocated resources.
- Existing compound allocations recorded as positive expense reductions are restored in the editor and converted on explicit save without double counting.
- Reopening and saving preserves income allocation and compatible account-transfer requirements, including completed-transfer protections.
- Assisted investment-sale input creates balanced lines from the receiving account, investment account, proceeds, and disposed book value. Account selection and budget selection remain separate.
- Japanese, English, French, Spanish, Simplified Chinese, and Traditional Chinese have complete new copy.
- Existing real journal records are not rewritten automatically.

## RED evidence

`bun test frontend/src/components/MultiLineIncomeBudget.test.tsx`

Executed on dev before implementation: 0 passed, 3 failed. The real compound entry component lacks income allocation controls, principal-return explanation, and assisted investment-sale input. Output: `.tmp/compound-income/red.log` (local, ignored).

## Planned verification

- Targeted calculation and API tests for proceeds/principal/gain, allocation conversion, save/reopen, excluded accounts, rounding, and transfer limits.
- Targeted component tests above.
- Frontend typecheck/build and an isolated headless browser flow, reusing the existing project dev server where practical.
- Independent review of financial state and regression risks.

## GREEN evidence

- Shared boundary, input component, allocation/transfer API, ordinary income, excluded cash/refunds, expense limits, and deferral regressions: 84 passed, 0 failed (295 assertions).
- Income/principal reconciliation plus existing consistency tests: 19 passed, 0 failed. The separate reconciliation RED checkpoint is `5440eed`; its GREEN fix is `4b5ad57`.
- Focused coverage: 9 passed, 0 failed; 81.28% lines overall for that group, 96.99% lines and 100% functions for `shared/journalIncomeBudget.ts`.
- Frontend TypeScript and Vite/PWA production build: passed.
- Worker TypeScript diagnostics against pre-task `1498b22`: 112 baseline and 112 current, no added diagnostics.
- Six-locale key parity and UTF-8 without BOM checked.

Local ignored evidence: `.tmp/compound-income/{check-green.log,coverage.log,frontend-build.log,worker-typecheck.json,browser/results.json}`.

## Real input-path verification

`worker/tests/investmentSale.browser.mjs` uses the existing Vite instance and `worker/tests/helpers/investmentSaleQaServer.ts`, which supplies only a disposable in-memory D1 implementation. All API requests are intercepted and sent to that fixture. No production or regular local D1 records are written.

Headless Chrome at 1440px and 390px passed:

- legacy positive allocation conversion while preserving a separate negative allocation and both category balances;
- assisted creation with full proceeds allocated and full-proceeds account placement tasks;
- unchanged save/reopen without erasure or duplication;
- scheduling-only edits;
- changing disposed book value and gain while leaving proceeds unchanged;
- changing the receiving bank and clearing obsolete tasks;
- changing to excluded cash and explicitly clearing the still-visible allocation;
- compound income credited to a budget-deducted card, with no physical transfer task.

Additional desktop flows passed for mixed route deferral preservation, multiple receiving banks, and cross-category rounding (59,999 / 60,001 against two 60,000 inflows).

The test API and headless browser were stopped after verification. Existing Vite/Worker development processes were retained.

## Independent review

Reviewed budget boundaries, returned principal, legacy conversion, signed allocation preservation, edit equality checks, route/defer-state preservation, excluded-account editing, and currency rounding. All actionable findings were fixed and rechecked; no unresolved data-loss, over-allocation, or unsavable-edit finding remained in the review scope.

Existing real records are converted only through an explicit edit/save. This change requires no database migration.
