# Budget adjustment preview read volume

## Acceptance criteria

- Editing only the note sends no preview request and causes no DB read. The
  preview stays usable, and saving records the latest normalized note.
- Consecutive amount edits retain authoritative caps, overflow, negative-claim,
  reset and currency behavior while reusing the unchanged underlying history.
- A database revision change invalidates preview read reuse. Date/currency and
  database binding identities remain isolated.
- Saving bypasses reuse across requests and recomputes from the current DB.
  Financial input mismatches and changed state reject the preview. The existing
  write-boundary revision guard, replay rejection and atomic rollback remain.
- A read-only preview POST does not invalidate unrelated summary, placement or
  reconciliation caches.

## Implementation boundaries

Notes are editable metadata and do not affect financial calculations. The
financial preview token binds the date, currency, amounts, DB revision,
timestamp and computed before/after state. The note is independently validated
and stored on save. Tokens issued before this contract change safely become
stale; they cannot bypass current verification.

Preview history reads may be reused within a bounded, short-lived Worker memory
cache keyed by the original DB binding, date, currency and live revision. Both
revision checks bypass memoization. Cold starts, other isolates, expiry and cache
limits can require a fresh read. Save does not depend on this cache.
Each binding retains at most two date/currency scopes, with a 30-second idle
expiry and at most 128 read results / 4 MiB of serialized results per scope.

## Verification

`cd worker && bun run test:db-reads` includes consecutive amount edits against
the actual budget route and workerd's `meta.rows_read`. It compares complete
numerical previews with fresh reads, checks a small per-edit read budget, forces
a revision change and verifies refreshed history and stale-save rejection.

The synthetic fixture contains 600 balanced journal entries, 1,200 journal lines,
600 allocations, 600 adjustment logs and 300 depreciation links. Before the fix,
the new repeated-edit case failed with **15,090 rows read for one amount edit**.

After the fix, the same isolated workerd test measured:

| Operation | Rows read |
| --- | ---: |
| Initial preview | 9,362 |
| Four consecutive amount edits | 6 each |
| Preview after changing DB revision | 9,362 (fresh history) |

All six read-volume integration cases passed. The refresh case also rejects the
old token and accepts a fresh token with the note entered locally. Counts describe
this fixture, rather than a guarantee across arbitrary production data or cold
Worker isolates.

The headless editor regression checks notes across pauses longer than the debounce
interval, no extra preview requests, a usable save action, and the final stored
note. Existing cases cover failed/stale previews, draft preservation, currency
precision, lost-response duplicate prevention and atomic saving.
The note-edit case asserts zero additional application API requests, so it cannot
cause a DB read through any application endpoint, not only the preview endpoint.
The browser suite passed with no page exceptions. A save-completion assertion
waits for committed logs instead of mistaking a temporarily disabled busy button
for completed saving.

All checks use synthetic, isolated databases. Normal local and production data
are not used by these tests.

## Final checks

- Backend: 21 targeted tests passed across D1 memoization, adjustment batch and
  preview reads, plus the existing depreciation preview regressions.
- Frontend: 16 targeted tests passed across preview cache behavior, summary cache
  races, shared reconciliation reads and editor rendering.
- Workerd: 6 read-volume integration tests passed.
- The complete headless adjustment-editor browser regression passed.
- Frontend typecheck/build and Worker dry-run build passed. Worker-wide TypeScript
  retains pre-existing unrelated diagnostics; changed backend files have none.
- Independent review found no unresolved correctness or save-integrity issues.
- Test-started servers and browser processes were stopped. No schema migration
  or production deployment was performed for this change.
