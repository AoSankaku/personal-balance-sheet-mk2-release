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
| Missing source-account guidance | `worker/tests/budgetInstallmentSetup.browser.mjs` | `0 !== 1`: feature switch is absent when the API's eligible-account list is empty. |

Logs are ignored under `.tmp/installment-setup/`. Browser verification reuses Vite on port 5173 and redirects actual `/api/` requests to the disposable in-memory QA API on port 18787. It never uses real local or remote D1 data.

## Intended verification

Frontend type/build checks, targeted naming/copy tests, and headless desktop/mobile flows for both missing and existing source accounts. Confirm the settings link, exact checkbox copy, disabled incomplete submission, and absence of horizontal overflow. No migration is expected.
