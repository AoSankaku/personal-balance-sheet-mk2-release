# Bottom notification history

User journeys were derived from the request to review disappearing notices and the supplied warning screenshot. No plan document was supplied.

## Behavior

- Settings includes a notification-history button opening exactly `/bottom-notification-history`.
- Every `showFeedback` notice is recorded when shown, independently of dismissal or the existing display timeout. The history lists the latest 50 notices, newest first, with timestamp, severity, exact message and originating screen/path. Explicit actions and available error details are shown when supplied.
- Browser-local storage retains history across reloads. Both displayed and persisted records are capped at 50. Invalid stored records are ignored; unavailable/full storage preserves a bounded live history instead of interrupting the action that produced a notification.
- Bulk card entry and CSV import capture their originating action before asynchronous work. The partial-success card warning includes the account, statement month and caught failure detail. This does not repeat journal posting or change statement-completion behavior.
- Card month-selection warnings include the account/month action. Notification side effects were moved out of the React state updater so StrictMode does not record them twice.
- The history route follows the app's existing privacy-mode block. New copy is translated in all six supported locales.
- History begins after this feature is installed. Previously expired notices were not stored and cannot be reconstructed. History is local to this browser, not synchronized across devices.

## RED / GREEN evidence

| Guarantee | Target | RED | GREEN |
| --- | --- | --- | --- |
| Expired/dismissed notices remain recorded; actions/details are retained; rapid notices cap at 50 | `frontend/tests/feedbackHistory.test.ts` | Missing `getFeedbackHistorySnapshot` export | Three feedback integration tests pass |
| Persist/restore, immutable stable snapshots, retention, validation, storage failure, deduplication and interleaved writes | `frontend/src/lib/bottomNotificationHistory.test.ts` | History-store module absent | Store behavior tests pass |
| Failed storage writes do not erase the live warning when opening history | Same store tests | Append under quota error followed by reload lost the warning | Pending in-memory records survive reload and remain bounded until persistence succeeds |
| Render full context safely and wire the exact route/title/Settings link/privacy guard | `frontend/tests/notificationHistoryPage.test.tsx` | New feature acceptance coverage | Render and wiring checks pass; message markup is escaped |
| Existing localization, privacy, card-completion and bulk-posting behavior | Targeted existing tests | Existing regression checks reused | All selected checks pass |

## Verification

From the repository root:

```powershell
bun test --coverage frontend/tests/feedbackHistory.test.ts frontend/src/lib/bottomNotificationHistory.test.ts frontend/tests/notificationHistoryPage.test.tsx frontend/tests/i18nTranslations.test.ts frontend/tests/privacy.test.ts frontend/tests/darkThemeAudit.test.ts frontend/tests/appMetadata.test.ts frontend/tests/creditCardManualCompletionFlow.test.ts worker/tests/bulkEntrySubmissionFlow.test.ts
node node_modules/typescript/bin/tsc --noEmit -p frontend/tsconfig.json
```

- 49 tests pass across nine files; frontend TypeScript passes.
- Store function/line coverage: 100%/99.46%. Feedback function/line coverage: 80%/80.30%. This is targeted coverage, not a project-wide claim.
- Headless Chromium verifies the Settings button and empty state, real bulk journal posting followed by an intentionally failed completion response, warning expiry, source card/August statement/action/error details in history, full reload, 55 new notices retaining exactly the newest 50 in UI and storage, and privacy blocking.
- A 390px mobile screenshot was visually inspected; the list fits the viewport without horizontal overflow. No browser JavaScript errors occurred.
- Browser verification used `.tmp/notificationHistoryBrowser.mjs` and `.tmp/notificationHistoryQaServer.ts`. An isolation marker was checked before mutations. Every application API request was routed to a loopback-only in-memory database with synthetic records. The completion failure was injected by the browser test, not inferred from the user's screenshot.
- The browser was closed; Vite and the synthetic API were stopped afterward.
- Independent review found the failed-write/reload edge. A reproducer first failed, then passed after pending-record retention; re-review found no remaining concrete concerns.

## Delivery

RED checkpoint: `672ff30`. The fix commit contains implementation, store tests and this report. No database migration or production financial-data change is required by this feature. Production deployment was not performed and no commits were pushed.

The screenshot warning indicates that journal posting succeeded and the later card statement completion failed. The original failure cause cannot be recovered from that message alone. New occurrences retain any available caught error detail and operation context; the notification-history feature does not claim to fix the underlying completion error.
