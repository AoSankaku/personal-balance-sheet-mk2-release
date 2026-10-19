# Open the original purchase from a monthly entry

Source: the user's request to make the warning's original-purchase text switch directly to that entry's editor.

## Intended behavior

- In a monthly installment/depreciation entry's edit modal, activate the inline original-purchase control with pointer or keyboard.
- Fetch the source entry by the schedule's `source_journal_entry_id`, even when the purchase is outside the current journal date filter.
- Change the parent's actual editing target and initialize the original purchase form. Saving must use the original purchase/plan save path, never the monthly journal entry's ID.
- On loading failure, keep the current monthly entry and allow retry. Ignore late responses after closing, changing entries, unmounting, or entering privacy mode.
- Wire the shared modal in the ledger and both balance-reconciliation entry points. Update all six locales; financial calculations remain unchanged.

## RED

`worker/tests/depreciationSourceEntry.browser.mjs` opened the legacy fixture's October monthly entry with the warning visible. It failed after 7 seconds waiting for the `元の購入仕訳` button, which does not exist in the current plain warning text. The July source purchase is outside the displayed journal date range. Log: ignored `.tmp/depreciation-source-entry/red.log`.

The browser uses an existing Vite server and redirects actual application API requests to the isolated in-memory QA API on port 18787. The browser date is fixed to 2026-10-19 to match the fixture. Real local/remote D1 is never used.

## Verification intent

Frontend build/type checks and focused locale checks, then the same headless browser regression at desktop/mobile widths. Cover failure/retry, keyboard activation, fresh source-form values, closed/reopened editor response races, and an actual isolated save with endpoint assertions. No database migration or production deployment is required.
