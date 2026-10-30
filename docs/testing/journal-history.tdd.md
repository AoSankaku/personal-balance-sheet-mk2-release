# Retained journal deletion and edit history

## Behavior

Deleting a journal removes it from the active ledger and retains an independent copy marked `is_deleted=true`. Updating a journal retains its pre-edit version with the same flag and reason `edited`. Immutable copies live in `journal_deletion_candidates`, outside all active accounting tables, so they cannot affect balances, budgets, depreciation calculations, or loan state. Snapshots retain original IDs, names, lines, currency precision, income mode/filter metadata, and associated budget/loan/transfer/depreciation/reconciliation records without foreign keys to live records.

`journal_history_settings` stores a global retention limit, initially 100, configurable from 1 to 10,000. Both deleted and pre-edit versions share this limit. Insertion sequence, rather than transaction date, determines oldest history. SQL triggers retain at most the configured number, including immediately after reducing the limit. Snapshot insertion, eviction, and the journal mutation run in the same D1 transaction, so a failed operation restores both the active journal and any temporarily evicted history.

Settings links to `/settings/journal-history`. The read-only page shows reasons, timestamps, original journal IDs, descriptions, account lines, currencies and meaningful budget details, with server pagination of 50 entries per page. Lowering the limit below the stored count confirms the exact number to be permanently removed. Saving locks pagination; confirmation freezes its proposed limit. Loading failures disable saving and offer retry. The route is blocked in privacy mode. New copy is available in all six supported locales.

No restoration action was requested or added. History begins with operations performed after this change; previously hard-deleted versions cannot be reconstructed.

## Mutation coverage

- Ordinary journal deletion/edit, bulk deletion/account replacement, and budget-reference classification changes.
- Account replacement, including captured names before the old account is removed.
- Configured and legacy depreciation edits/deletions. Legacy regeneration was converted from separate writes to one atomic batch; a no-op does not create history.
- Canceling generated income transfers, resolving unknown funds, and deleting balance confirmations.
- Ledger-only erase scopes retain removed journal snapshots. Explicit account/all-data wipes clear history as well; all-data resets retention to 100.
- Routine refreshes of derived balance adjustments do not create history, avoiding repeated snapshots of automatically recomputed rows.

## RED / GREEN evidence

RED checkpoints on this task's active branch: `7dd0b8d` (API behavior) and `2b593ac` (settings UI contract). The initial API target ran with 7 failures because history functionality was missing. Subsequent review findings were separately reproduced before correction: 9-decimal display rounding, depreciation currency conversion, preserved names for removed categories, and balance-adjustment currency conversion.

Current verification:

```powershell
bun test --coverage worker/tests/journalHistory.test.ts worker/tests/journalHistorySpecialized.test.ts
bun test worker/tests/accountingIntegrity.test.ts worker/tests/actualBalanceAdjustments.test.ts worker/tests/budgetInstallmentTransferNaming.test.ts worker/tests/depreciationBudget.test.ts worker/tests/incomeTransferRequirements.test.ts
bun test frontend/tests/journalHistorySettings.test.ts frontend/src/pages/JournalHistoryPage.test.ts
node node_modules/typescript/bin/tsc --noEmit -p frontend/tsconfig.json
```

- New API/specialized cases: 15 passed, 66 assertions. Both the history helper and history router have 100% function/line coverage in this targeted run.
- Related accounting/depreciation/transfer regression cases: 65 passed, 370 assertions.
- Frontend/translation cases: 3 passed, 475 assertions.
- Frontend TypeScript passes. Worker typechecking with `--skipLibCheck` retains 26 pre-existing diagnostics in actualBalanceAmounts.test.ts, moneyValidation.ts, admin.ts, crypto.ts, incomeTransferRequirements.ts and longTermLoanPlans.ts; no new diagnostics were introduced.
- Independent review found the precision/data-preservation issues above and a page-switch/save race. All were corrected; final re-review found no remaining concrete issues.

Headless Chromium (`.tmp/journalHistoryBrowser.mjs`, `.tmp/journalHistoryQaServer.ts`) verified real API-backed ledger deletion, settings navigation, deleted and pre-edit copies, full lines, two-page navigation, delayed PATCH controls, cancellation without purge, confirmed oldest-first eviction from 54 to 2, persistence across reload, failed load/retry, mobile width, and privacy blocking. No JavaScript errors occurred. A 390px mobile screenshot was inspected. Requests were isolated to a synthetic in-memory database; no actual financial records were read or changed. The browser and temporary servers were stopped afterward.

## Migration and delivery

Append-only migration `0021_journal_deletion_candidates.sql` was successfully applied to local D1. It was also exercised by disposable test databases using all real migration SQL. No production migration/deployment or remote push was performed. Production rollout requires the repository's full remote snapshot and restore-verification procedure before applying this migration.
