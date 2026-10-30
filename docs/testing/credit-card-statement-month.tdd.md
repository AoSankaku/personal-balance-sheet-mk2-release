# Credit-card automatic trial-balance month

The reported journey is a confirmed card CSV automatically filling the trial-balance card section one month later than intended. The legacy `CreditCardStateEntry.payment_month` field represents the statement/closing month. The UI derives the actual payment month from it. Confirmed CSV input incorrectly stored the actual payment month, which the UI then advanced a second time.

## Acceptance and regression coverage

- SMBC confirmed input uses the dominant closing month, including rows on either side of the closing day. An August closing period with next-month billing displays as September payment.
- Rakuten confirmed input converts its actual payment month back to the closing month using the configured billing delay, including year rollover.
- Net totals retain refunds and all CSV rows. Draft CSV input does not create confirmed state.
- Withdrawal warnings use each card's closing-month key for the upcoming actual withdrawal date. A later statement is not mistaken for this month's withdrawal.
- Actual payment months in separate statement-completion records keep their existing meaning.
- Saving and retrieving CSV-derived state through the real trial-balance API retains its closing-month key and leaves another card and a manually saved earlier month intact.

## RED / GREEN evidence

RED checkpoint: `8d92e10` (`test: reproduce credit card statement month shift`). The focused run had 19 passing and 9 failing tests. The failures reproduced the incorrect CSV key and the withdrawal lookup mismatch.

The final targeted run passed **47 tests across 8 files**, with 104 assertions:

```powershell
bun test frontend/src/lib/creditCardStatementCompletion.test.ts frontend/tests/creditCardWithdrawalRisk.test.ts frontend/tests/tt-credit-card-opening-balance.test.ts frontend/tests/trialBalanceStatementCompletion.test.ts frontend/tests/creditCardManualCompletionFlow.test.ts frontend/src/lib/creditCardImportTasks.test.ts frontend/tests/trialBalanceMonthlyTaskFlow.test.ts worker/tests/creditCardStatementMonthRoundTrip.test.ts
node node_modules/typescript/bin/tsc --noEmit -p frontend/tsconfig.json
```

Frontend TypeScript passed. The new API round-trip uses actual migration SQL and disposable in-memory SQLite, including the actual Shift-JIS SMBC parser, PATCH, GET, and the same display helpers as the UI.

Headless Chromium acceptance (`.tmp/cardMonthBrowser.mjs`, `.tmp/cardMonthQaServer.ts`) used a synthetic card named amazonマスター with explicitly chosen test settings. It verified that the August CSV-derived amount 3,000 appears under September payment, October stays blank, and this remains true across two reloads. No browser JavaScript errors occurred. All API traffic was directed to the isolated in-memory fixture; no real financial data was read or modified. The browser was closed and the temporary servers were stopped.

An independent review checked all state consumers and the distinction between statement-month state and actual-payment-month completion records; no concrete issues remained.

## Existing records and delivery

Previously mis-keyed records are not automatically moved: saved state has no reliable origin metadata to distinguish an affected CSV amount from a legitimate manual amount. Such entries need a month-by-month correction. No schema migration, production deployment, or remote push is part of this change.
