# Event expense tags

## User journeys and decisions

- Attach reusable tags such as `2026年秋旅行` to expenses, create tags inline, and reopen them from the ledger.
- Simple entry uses automatic expense net. Compound entry initializes the tag amount from expense debits minus credits, permits an explicit manual amount, and retains it through drafts and editing. Zero and negative refund amounts are valid.
- Manual amounts are event-analysis metadata. They do not change accounting lines, budget consumption, or the accounting amounts in the filtered P&L. Ledger/P&L show a separate tag total and per-tag breakdown. This interpretation was stated while the optional clarification was pending.
- Multiple selected tags use OR matching. The combined total counts each journal once; individual tag totals can overlap. Refunds reduce spending. Currency amounts stay separate unless the P&L's existing combined-currency display is explicitly enabled.
- Ledger tag-only editing works even for managed journals, without relaxing restrictions on their accounting lines. Depreciation input directs users to this editor.

Tags are normalized into a reusable catalog and per-journal associations. Only manual overrides are stored as scaled currency amounts; automatic values are derived from current expense-account lines, so account replacement does not leave stale defaults. Omitting metadata on an update preserves it; an explicit empty tag array clears tags and overrides.

Both ordinary and tag-only edits retain pre-edit metadata in the immutable deletion-candidate history. Archived names, amounts and currency precision remain independent of live records. Depreciation regeneration copies tag assignments and raw manual amounts to replacement journals with the corresponding month number, within the same transaction. Removed months remain in history; newly added months do not inherit unrelated monthly tags. An explicit erase-all removes saved event names as well.

## RED / GREEN evidence

Task RED checkpoint: `4e0314e` (`test: define event expense tag accounting defaults`). The shared tag calculator/filter module was missing. Backend API tests separately reproduced ignored tag fields, missing response metadata, and unenforced manual-mode validation before implementation.

Review identified and corrected these additional regressions:

| Guarantee | Evidence |
| --- | --- |
| Manual input and submission agree | A cleared field remains blank and blocks saving; untouched manual mode submits the displayed default; explicit zero is accepted |
| Header currency changes cannot submit a stale override | Input state resets to Auto and clears previous overrides; headless JPY → USD → JPY transition passes |
| Non-expense simple edits preserve existing tags | Normal income/transfer/loan and business-advance submission paths retain metadata |
| Unsupported depreciation input cannot appear editable | Tag control is hidden during depreciation input; the ledger metadata-only editor is available |
| Regenerated depreciation retains event metadata | Configured and legacy paths reproduce lost tags before the fix, then retain names/manual amounts by month number |
| Failed regeneration is atomic | Forced journal-line insertion failures preserve original journals, schedule, tags, amounts and history in both paths |
| Large ledger loading stays bounded | 200 entries load with three reads and a 100-parameter constraint, using bound JSON ID arrays; batches are bounded at 5,000 IDs |

## Verification

Final targeted run: **109 tests passed across 16 files**, 998 assertions.

```powershell
bun test --coverage shared/expenseTags.test.ts frontend/src/lib/expenseTagSummary.test.ts frontend/src/lib/expenseTagInput.test.ts frontend/tests/offlineDrafts.test.ts frontend/src/components/JournalTable.test.tsx frontend/src/components/MultiLineIncomeBudget.test.tsx frontend/tests/displayCurrencyAmounts.test.ts worker/tests/expenseTags.test.ts worker/tests/expenseTagErase.test.ts worker/tests/expenseTagDepreciation.test.ts worker/tests/expenseTagConcurrency.test.ts worker/tests/journalHistory.test.ts worker/tests/journalHistorySpecialized.test.ts worker/tests/journalBatchParity.test.ts worker/tests/regularIncomeEditing.test.ts worker/tests/accountingIntegrity.test.ts
node node_modules/typescript/bin/tsc --noEmit -p frontend/tsconfig.json
```

The shared expense calculator and frontend summary helper have 100% function/line coverage. The input helper has 90%/89.29%; the backend tag helper has 93.75%/95.63%. These are targeted helper measurements, not project-wide coverage claims. Additional depreciation regression verification passed 56 tests across the affected depreciation/history files.

Frontend TypeScript passes. Worker checking with `--skipLibCheck` retains the same 26 pre-existing diagnostics; none were introduced in the changed worker source. New strings are present in all six supported locales. Independent review findings were corrected and the affected changes re-reviewed.

Headless Chromium acceptance used `.tmp/expenseTagsBrowser.mjs` and `.tmp/expenseTagsQaServer.ts`, with all API traffic redirected to an isolated in-memory database:

- Simple expense 1,000 with two reusable tags, automatic amount and successful persistence.
- Compound default 500, blank validation, currency reset, manual amount 200 while the accounting expense stays 500.
- Reopening a two-line manually attributed entry uses the compound tab and restores 200.
- Tag-only editing preserves the manual amount; OR filtering excludes untagged journals and counts a refund once.
- Tag total 1,100 is displayed separately from filtered accounting expense 1,400 in P&L.
- Pre-edit history retains tags and manual amounts. Mobile layout fits at 390px. No JavaScript errors occurred.

The browser and temporary servers were stopped. No actual financial records were read or changed during acceptance testing.

## Migration and delivery

Append-only migration `0022_expense_tags.sql` was applied successfully to local D1 and exercised by disposable test databases. No production migration/deployment or remote push was performed. A production rollout must follow the repository's complete remote snapshot and restoration-verification procedure before migration.
