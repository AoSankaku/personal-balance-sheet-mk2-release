# Preserve regular income settings during editing

Journeys were derived from the reported bug: after saving regular income with a budget filter, reopening it to change its date showed the regular-income switch as off. No plan document was supplied.

## Behavior and compatibility

- Persist regular-income mode and the selected filter independently of the actual allocation amounts.
- Restore both fields when opening the saved income entry. Editing its date retains the saved amounts, including manual overrides and intentionally zero allocations, instead of applying the filter again.
- Keep matching defaults eligible for normal amount recalculation. Restore manually changed rows as dirty, and sum multiple saved rows for the same category without losing money.
- Preserve metadata when older clients or the multi-line editor omit it on compatible updates. Clear incompatible metadata when an older client changes income into an expense. Explicitly turning regular mode off clears its filter selection.
- Regular mode can remain on without a filter. Deleted filters become null while the saved allocation and regular mode remain intact. Inactive saved filters remain selectable in the edit form.
- Old entries have no recorded mode/filter. Keep their saved allocations without guessing which filter or mode they originally used. Select the intended filter and save once to establish metadata for future edits.

## RED / GREEN evidence

| Guarantee | Regression target | RED evidence | GREEN evidence |
| --- | --- | --- | --- |
| Create/list/detail and batch retain mode/filter | `worker/tests/regularIncomeEditing.test.ts` | Original journal API omitted both fields | Typed boolean and nullable filter survive API round trips |
| Date-only edits preserve settings and allocation without duplication | Same API tests | Updated entries lacked the settings | 750 remains 750 in exactly one linked adjustment row after the date change |
| Validate types, filter references, currency and applicable income shape | Same API tests | Original API ignored metadata | Invalid input returns 400 in create and update |
| Restore selection and exact manual/zero amounts | `frontend/src/lib/incomeBudgetDraft.test.ts` | Edit-draft helper was not implemented | Settings are restored, date changes have no effect, and manual/zero rows are dirty |
| Sum repeated saved category allocations | Same frontend tests | Reviewer reproducer restored 300 + 450 as 450 | Restores 750 after aggregation |
| Complete UI create/edit/reload journey | Headless Chromium and synthetic in-memory API | Persistence defect established by API reproducer | New-form date change, save, reopen, date-only edit and reload all retain the selected filter and manual 600/400 allocation; no browser errors |

## Verification

From the repository root:

```powershell
bun test --coverage frontend/src/lib/incomeBudgetDraft.test.ts worker/tests/regularIncomeEditing.test.ts frontend/tests/simpleEntryBudgetDistribution.test.ts frontend/tests/simpleIncomeDescription.test.ts worker/tests/journalBatchParity.test.ts worker/tests/incomeBudgetScope.test.ts
node node_modules/typescript/bin/tsc --noEmit -p frontend/tsconfig.json
```

- 57 targeted tests pass across six files.
- Income edit-draft helper function/line coverage: 100%/100%. Worker selection helper: 100%/98.04%. This is changed-helper coverage, not a project-wide claim.
- Frontend TypeScript passes.
- Worker TypeScript with `skipLibCheck`: 26 pre-existing diagnostics. Compiler-host comparison against `646acdd` reports 26 before/after and no new diagnostics.
- Independent review identified the repeated-category restoration issue; its regression first failed and then passed after aggregation. Re-review found no remaining concrete concerns.

Browser acceptance used `.tmp/regularIncomeBrowser.mjs` and `.tmp/regularIncomeQaServer.ts` with the bundled Playwright package. The test verified an isolation marker and routed every application API request to a loopback-only API using `createIncomeBudgetScopeFixture`; it never used the existing local or production database. The test API and Vite were stopped afterward.

## Migration and delivery

`0020_journal_regular_income.sql` adds a boolean column defaulting to off and a nullable filter foreign key with `ON DELETE SET NULL`. It does not rewrite existing allocation amounts or earlier migration files. Real migrations run in disposable test databases; Wrangler also successfully applied 0020 to the project's local D1 database.

Production migration/deployment was not performed. Follow the required production snapshot and restore verification procedure before applying 0020 and deploying the updated Worker/frontend.

RED checkpoint: `f154147`. The fix commit contains the GREEN implementation and this report. No commits were pushed.
