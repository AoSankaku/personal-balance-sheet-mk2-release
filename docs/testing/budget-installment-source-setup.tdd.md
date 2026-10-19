# Budget installment transfer name and source-account guidance

Source: the user's latest naming and setup-guidance request, without a supplied plan document.

## User journeys

- See the feature as `予算分割振替（減価償却）`, including future generated entry/category names and the six localized UI/guide variants.
- When adding an asset account, understand that the checkbox excludes it from budget resources and marks it as a source for this feature. Japanese label: `予算の対象外とし、予算分割振替（減価償却）元として扱う`.
- Select the feature even without an eligible asset account, receive account-creation instructions, and follow a link to the existing account settings. Prevent submitting an incomplete purchase until an eligible account exists.
- Preserve the accounting, allocation, and rounding behavior and the preceding removal of unexplained `U` notation.

## RED

All checks below executed against unchanged production code before implementation.

| Behavior | Target | Runtime evidence |
| --- | --- | --- |
| Feature and checkbox copy | `frontend/src/i18n/depreciationBudgetFeatureCopy.test.ts` | 6 passed / 7 failed: six feature names and the Japanese checkbox still use the earlier wording. |
| Future generated names | `worker/tests/budgetInstallmentTransferNaming.test.ts` | 3 failed: generated descriptions lack the requested parenthetical name. |
| Missing source-account guidance | `worker/tests/budgetInstallmentSetup.browser.mjs` | After waiting for the actual form to load, `0 !== 1`: feature switch is absent when the API's eligible-account list is empty. |

Logs are ignored under `.tmp/installment-setup/`. Browser verification reuses Vite on port 5173 and redirects actual `/api/` requests to the disposable in-memory QA API on port 18787. It never uses real local or remote D1 data.

The initial browser assertion ran before input loading completed. The test now waits for the ordinary amount field before checking the missing switch. The corrected RED was validated against the original `ExpenseSection.tsx` from checkpoint `3909e37`, and the current source was restored in a `finally` block. The loaded-form failure is recorded in `setup-red-loaded.log`.

Visual inspection also found that the asset dialog offered both budget-source inclusion and source-asset exclusion simultaneously. A browser assertion requires hiding the inclusion control while source mode is selected and restoring its previous preference when source mode is deselected. This changes only the displayed controls; the existing budget scope already excludes source assets by `is_depreciable`.

Account-scope RED: `1 !== 0` for `Budget-excluded source accounts must not simultaneously offer inclusion in budget resources`, recorded in `account-scope-red.log` before changing `AddAccountModal.tsx`.

## Intended verification

Frontend type/build checks, targeted naming/copy tests, and headless desktop/mobile flows for both missing and existing source accounts. Confirm the settings link, exact checkbox copy, disabled incomplete submission, and absence of horizontal overflow. No migration is expected.

## GREEN

- Final frontend TypeScript/Vite/PWA build succeeded.
- Frontend copy and allocation-form checks: 27 passed, 0 failed, 1,092 assertions across three files. All six agreed feature names and the exact Japanese checkbox copy pass.
- Worker generation/repair checks: 27 passed, 0 failed, 206 assertions across two files. New monthly entries and special-budget names use the new display name; special-budget reuse remains intact.
- `budgetInstallmentSetup.browser.mjs` passed at 1440px and 390px: an empty eligible-asset list leaves the feature discoverable, shows creation guidance, disables incomplete installment submission, and links to account settings. The modal presents the exact checkbox wording; its budget-inclusion control hides while source mode is selected and restores the previous choice when deselected. Ordinary expense mode remains available. Horizontal overflow and page exceptions: 0.
- `budgetInstallmentLayout.browser.mjs` passed at both widths with existing source accounts: input remains enabled, manual ratios/amounts and rounding work, account-default restoration and explicit unallocated confirmation work, and card offsets/business-advance controls remain available. Page exceptions: 0.
- Mobile guidance and account-modal screenshots were inspected. Guide IDs and filenames remain unchanged; all six localized setup guides and double-entry references use the updated feature name.
- Accounting algorithms, account payloads, schema, and migration files were not changed. Existing user-authored/stored entry and category names are not bulk rewritten. No remote push or production deployment was performed.
