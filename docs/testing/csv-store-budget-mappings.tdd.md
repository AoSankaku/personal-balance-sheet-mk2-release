# CSV store budget category persistence

User journeys were derived from the reported CSV import bug and screenshot; no plan document was supplied.

## Behavior

- Selecting an income account and budget category, then clicking "Apply to same store", saves both IDs on the server and applies both to matching deposit rows immediately.
- Reloading the page and uploading a subsequent CSV restores the saved account and category, using the existing store-name whitespace normalization.
- Changing or clearing only the budget category follows the existing overwrite confirmation. The confirmation and CSV settings list show the category.
- Account-only mappings remain supported. Withdrawals do not acquire income budget allocations. Deleting a category clears its reference without deleting the store mapping; archived categories are ignored on reload and rejected on save.

## RED / GREEN evidence

| Guarantee | Test | RED | GREEN |
| --- | --- | --- | --- |
| Save, reload, overwrite, clear and preserve legacy account-only requests | `worker/tests/storeMappings.test.ts` | Original API discarded `budget_category_id`; persistence assertions failed | API round trips pass against real migrations in disposable SQLite/D1 fixtures |
| Validate category/account references and retain the account mapping on category deletion | Same API tests | Invalid category was accepted; nullable field was absent | Invalid selections return 400 without changing the stored mapping; deletion returns a null category |
| Archived categories cannot silently receive future CSV income | Same API tests | Save → archive → GET returned the archived ID | GET returns null for the category and keeps the account; saving the archived ID returns 400 |
| Restore and apply matching deposit categories, clear selections, preserve unrelated rows | `frontend/src/lib/csvStoreMappings.test.ts` | Helper extraction was not yet implemented | Four behavior tests pass, including whitespace matching and account-only legacy data |
| UI wiring through actual import | Headless Chromium with synthetic API and an in-memory DB | Original defect established by the API reproducer | Saving, immediate application, settings display, reload/reupload, category-only overwrite and journal import all pass; imported 173 and 180 each carry category 1002; no browser errors |

## Verification

From the repository root:

```powershell
bun test --coverage frontend/src/lib/csvStoreMappings.test.ts worker/tests/storeMappings.test.ts frontend/src/utils/csvInputUtils.test.ts frontend/tests/csvImportWarnings.test.ts frontend/tests/csvImportHistory.test.ts worker/tests/incomeBudgetScope.test.ts
node node_modules/typescript/bin/tsc --noEmit -p frontend/tsconfig.json
```

The targeted tests pass. Frontend mapping helper function/line coverage is 100%; the store mapping route exceeds 80%. Coverage of other imported application modules is not a project-wide coverage claim.

Frontend TypeScript passes. Worker TypeScript with `skipLibCheck` has 26 pre-existing diagnostics; a compiler-host comparison using the original shared types, schema and route from `c1bdd80` reports the same 26 diagnostics and no additions.

Browser acceptance used `.tmp/csvStoreMappingBrowser.mjs` and `.tmp/csvStoreMappingQaServer.ts`, with the bundled Playwright package and a loopback-only API backed by `createIncomeBudgetScopeFixture`. Every application API request was routed to the synthetic API after checking its isolation marker. Both the test API and Vite were stopped afterward. Browser automation was headless.

Independent review found the archived-category case. The added regression first failed, then passed after filtering inactive categories from mapping reads. Re-review found no remaining concrete issues.

## Migration and deployment

`0019_store_mapping_budget_category.sql` adds a nullable foreign key with `ON DELETE SET NULL`. Earlier migration files are unchanged. All migration SQL is exercised in isolated test databases, and Wrangler successfully applied 0019 to the project's local D1 database.

Production migration and deployment were not performed. Production requires the repository's full snapshot/restore verification procedure before applying 0019 and deploying the new Worker/frontend.

The initial RED checkpoint is `7788cbf`; the fix commit preserves the GREEN results and this report. No production records or financial calculations were changed during verification.
