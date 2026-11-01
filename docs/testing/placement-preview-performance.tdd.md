# Placement preview request and evidence performance

The current-placement panel was recalculating the same preview independently in
navigation tasks, transfer tasks, and the panel. The evidence builder also scanned
all allocation and journal-line rows again for every entry.

## Behavior and bounded changes

The client now shares pending reads and successful results for 30 seconds, scoped
by currency and the application's Asia/Tokyo day. Remounting a panel can use a
fresh result immediately. Explicit refresh bypasses settled results; focus,
visibility, and online events refresh expired results. Failures are not cached.

Writes invalidate this memory-only cache before and after the request, including
raw API writes, uncertain failures, and mutations not covered by budget revisions.
Only the exact notification-preferences endpoint `/task-settings` is exempt: its
fields do not affect placement. Old in-flight reads cannot repopulate an invalidated
cache. Offline reads do not expose a cached actionable plan.

The Worker indexes expense allocations and lines by journal entry before building
evidence. Existing date, currency, reference, and reset filtering, eligibility,
ordering, and currency decoding are preserved. Preview snapshot queries and
completion's fresh calculation, token validation, signatures, and guarded batch
are unchanged. No server snapshot cache, schema change, or migration is introduced.

## Measurements

Two bounded candidates were measured: client request sharing and indexed evidence
construction. Financial rules and transfer generation were not optimization targets.

| Synthetic workload | Before | After |
| --- | --- | --- |
| Three simultaneous consumers plus six unchanged reads, three runs | 9 requests each | 1 request each |
| Same client workload, simulated 5 ms network delay, median of three runs | 109.27 ms | 15.09 ms |
| Evidence construction, 2,000 allocations and 4,000 lines, median of three paired runs | 14.22 ms | 1.60 ms |
| Evidence construction, 8,000 allocations and 16,000 lines, median of three paired runs | 235.76 ms | 3.86 ms |

The client harness uses the actual API client with a deterministic stub transport
and checks equal returned tokens. The evidence harness generates two-line cash
purchases with one allocation per entry, warms both implementations, and compares
their complete output with deep equality on every measured run. These are isolated
client/CPU measurements, not production endpoint or total page-load timings.
Local harnesses and logs are retained under ignored `.tmp/` directories.

## RED, verification, and review

The shared RED checkpoint is `5014f65`. Unchanged repeated reads produced nine
requests instead of one, and the new indexed evidence builder was absent. The
evidence fixture's multi-allocation entry was subsequently corrected to contain
the intended two journal lines; a separate three-line case still verifies exclusion.

Additional failing regressions reproduced a browser-local rather than JST cache
day at Japan midnight, and unnecessary invalidation after notification settings
were saved. Both pass after the scope and exact-endpoint fixes.

Commands from the repository root:

```powershell
node node_modules/typescript/bin/tsc --noEmit -p frontend/tsconfig.json
bun test frontend/tests/placementPreviewRequests.test.ts frontend/tests/expiringRequestCache.test.ts frontend/tests/inFlightRequestDeduper.test.ts frontend/tests/budgetPlacementReconciliationUi.test.ts
bun test worker/tests/budgetPlacementExpenseEvidence.test.ts worker/tests/budgetPlacementReconciliation.test.ts
bun test frontend/tests/reloadPrompt.test.ts frontend/tests/plannedExpenseCurrencyScope.test.ts
```

Frontend TypeScript passes. The four targeted frontend files pass 23 tests and
276 assertions; the two Worker files pass 12 tests and 61 assertions. The latter
include completion/stale-token behavior and a deterministic source-ID access test
for linear growth. Worker-wide TypeScript retains unrelated existing diagnostics;
none refer to changed production files. A further 22 API-client regressions pass
92 assertions for authentication recovery and planned-expense currency scope.
Combined targeted verification is 57 tests and 429 assertions.

Headless Chrome with a UTC browser clock on the previous calendar date verified
the authoritative JST-day plan, one request for concurrent initial consumers,
reuse through transfer-task/settings/panel navigation, a new token after a journal
write, one request after expiry and focus, and separate USD/JPY cache scopes.
No browser page errors occurred. The harness uses the application's actual loaded
API module, including Vite's development version suffix, to exercise the same cache
as the mounted UI. Browser, Vite, and isolated in-memory API processes were stopped.

Independent review identified the JST scope issue and confirmed its correction.
The final limited review found notification-only settings safe to exempt. No
production data, remote deployment, or push was performed.
