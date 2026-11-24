# D1 limit detection

The user requested D1 limit-error detection in the application and a separate
reusable Codex skill. The intended behavior is to explain a database quota
failure without treating it as Access expiry, discarding inputs, leaking query
data, or automatically replaying a write.

## Scope and contract

Recognized causes are daily row reads, daily row writes, and D1-qualified
per-invocation request limits. Daily limits carry the next 00:00 UTC as
`retry_at`; invocation limits carry null and no daily-reset promise. A bare
invocation-limit message without D1 provenance is deliberately left to ordinary
error handling because other bindings can use the same wording.

The API contract is HTTP 503 with `error: "d1_limit_exceeded"`, `limit_type`,
`retry_at`, and `Cache-Control: no-store`. Daily failures additionally return
`Retry-After` in seconds. The response is constructed from the classification,
not the raw ORM exception or SQL parameters. A shared frontend notice handles
JSON and download errors while keeping Access/version recovery separate.

Cloudflare references checked on 2026-11-10:

- [D1 error list](https://developers.cloudflare.com/d1/observability/debug-d1/)
- [D1 limits](https://developers.cloudflare.com/d1/platform/limits/)
- [D1 usage definitions](https://developers.cloudflare.com/d1/platform/pricing/)

## RED evidence

Checkpoint `b3ebba0` adds classifier, API, transport/store, locale, and alert
tests. Before implementation, the full-API target compiled and executed two
tests that both failed: quota failures returned HTTP 500 instead of HTTP 503.
The other new targets also exposed the absent classifier, shared contract, and
notice implementation. These are intended missing-feature failures.

Commands run from each workspace:

```powershell
# worker/
bun test ./tests/d1LimitApi.test.ts
bun test ./tests/d1Limits.test.ts
# frontend/
bun test ./tests/d1Limits.test.ts ./tests/d1LimitAlert.test.tsx
```

## Test guarantees

| Guarantee | Evidence target |
| --- | --- |
| Distinguish daily reads, daily writes and D1-qualified invocation limits | `worker/tests/d1Limits.test.ts` |
| Traverse wrapped/error-like causes safely without matching quota wording inside SQL | `worker/tests/d1Limits.test.ts` |
| Keep capacity, overload, timeout and unrelated limits distinct | `worker/tests/d1Limits.test.ts` |
| Compute next UTC midnight, including an error exactly at midnight | `worker/tests/d1Limits.test.ts` |
| Propagate quota instead of guessing currency precision | `worker/tests/d1Limits.test.ts` |
| Sanitize quota JSON/status/headers across reads, erase, Binance lookup and export | `worker/tests/d1LimitApi.test.ts` |
| Stop batch-error recovery without extra reads or replay | `worker/tests/d1LimitRecovery.test.ts` |
| Preserve quota causes through budget adjustment/placement account lookups after earlier reads succeed | `worker/tests/d1LimitInternalDispatch.test.ts` |
| Emit one notice and preserve ordinary errors and successful download bodies | `frontend/tests/d1Limits.test.ts` |
| Never automatically replay failed writes or turn a quota into Access recovery | `frontend/tests/d1Limits.test.ts` |
| Present distinct localized guidance, daily-only reset hints, and dismissal | `frontend/tests/d1LimitAlert.test.tsx`, `frontend/tests/d1Limits.test.ts` |

## GREEN verification

Final focused commands, run inside the indicated workspace:

```powershell
# frontend/
bun run build
bun test --coverage --coverage-reporter=text ./tests/d1Limits.test.ts ./tests/d1LimitAlert.test.tsx ./tests/reloadPrompt.test.ts
# worker/
bun test --coverage --coverage-reporter=text ./tests/d1Limits.test.ts ./tests/d1LimitApi.test.ts ./tests/d1LimitRecovery.test.ts ./tests/d1LimitInternalDispatch.test.ts ./tests/d1Errors.test.ts
bun run test:db-reads
```

- Frontend production build passed.
- Combined frontend quota/UI and Access/version regression targets: 28 passed,
  240 assertions. The new tests clear their API session cache before and after
  each case so successful stub responses cannot hide later Access/offline
  failures. No production cache behavior was changed for test isolation.
- Worker quota/classifier/API/recovery/internal-call targets: 14 passed,
  77 assertions. Both injected failed-batch cases assert that the target batch
  ran exactly once and that zero recovery reads occurred afterward.
- Coverage of the new notice component, notice store/localized error helper,
  and shared contract guard is 100% functions/lines. The extended Worker
  `d1Errors` module is 100% functions and 96.36% lines. Whole-process coverage
  includes unrelated imported application modules and is not presented as
  feature coverage.
- Additional account-balance, budget-preview-read and placement reconciliation
  targets passed with the changed helper. The existing planned-expense journal
  completion regression passed (one case, six assertions). The depreciation
  suite passed 23 cases with the one baseline failure described below.
- Independent implementation review found one lost-cause boundary at internal
  account subrouter requests. The shared-query correction and selective-failure
  tests resolved it; the follow-up review found no material regression.

## D1 read-volume evidence

The required isolated read-volume runner passed all six scenarios. Its initial
sandboxed run stopped in the setup hook because Wrangler could not write its
local development registry. A TAP reporter exposed that permission error; the
same test then passed with permission for that local cache write. No production
or real local D1 database was used, and no test-harness source was changed.

The representative fixture contains 600 journal entries, 1,200 journal lines,
600 expense allocations, 600 adjustment logs and 300 depreciation entries. A
lookup-growth case adds 2,000 unrelated lines, checks unchanged complete results
and bounded reads, then removes only those synthetic rows. Measurements below
are the existing regression suite's comparisons, not a claim of new query
optimization from the error-detection feature.

| Existing synthetic scenario | Measured `meta.rows_read` / queries |
| --- | --- |
| Selective line lookup, unindexed vs indexed | 1,200 vs 152 rows |
| Twelve 50-entry journal-log chunks | 1,799 rows total |
| Separate today/total budget summaries vs paired route | 11,452 / 28 queries vs 5,726 / 14 queries |
| Legacy account aggregate vs current whole account route | 3,600 vs 2,432 rows |
| Initial adjustment preview | 9,362 rows |
| Four consecutive amount edits with valid cached history | 6 rows each |
| Revision-change refresh | 9,362 rows |

The suite compares complete budget-pair responses and account balances, checks
bounded selective reads as unrelated data grows, and confirms fresh save-time
verification and stale-preview rejection.

## Existing verification limitations

One pre-existing regression remains outside this change: the depreciation-budget
case named “orders settlements against existing receipts and preserves a residual
plus future receipt” expects HTTP 200 from its preview but receives HTTP 400 at
line 254. It failed identically against an isolated pre-implementation `b3ebba0`
source snapshot with the same installed dependencies. The baseline run executed
that one case with 23 others filtered out. The fixture and its financial rules
were left unchanged. This is not a new quota-detection failure.

Tests use synthetic error strings and isolated fixtures. No real local or remote
D1 database is used to exhaust quota. Error handling and notices add no usage
probe, polling request, database query, or D1 log write. There is no schema,
index, migration, account, billing, or deployment change in this task. The account
read implementation is reused directly by internal budget callers instead of
round-tripping through a subrouter; SQL, parameters, ordering and mapping remain
the same.

Worker source typechecking was compared with the pre-implementation snapshot
using `bun node_modules/typescript/bin/tsc --noEmit --skipLibCheck -p worker/tsconfig.json`
(adjusted paths when run inside each Worker directory). Both versions exit 2
with the same 26 source diagnostics after normalizing shifted line/column
numbers; the change adds no source diagnostic. Dependency declaration noise is
excluded by `--skipLibCheck`. Existing source issues include money validation,
admin/crypto insert typing, income transfer requirements and long-term loan
plans, plus a `bun:test` type import in a pre-existing source test file.

## Reusable skill

`cloudflare-d1-limit-detection` is installed in the personal Codex skill library,
separately from this repository. It contains a framework-independent workflow,
cause/limit taxonomy, API and frontend integration guidance, a UTC-reset helper
example, and acceptance cases. It has no dependency on the two previously
created update/session skills or on this project's credentials and paths.

The skill passed the skill-creator validator, metadata/reference/UTF-8/private-data
checks, and an independent read-only review with no material findings. Its UTC
helper example passed one focused test with ten assertions covering midnight,
month/year rollover, and leap day. These are skill-example checks, not a claim
that production quota or the remote D1 service was exercised.

The implementation review additionally found that internal account subrouter
requests could replace the original quota with a generic HTTP 500 before the
outer handler could see it. The reusable skill now explicitly covers this
boundary and recommends preserving thrown causes through a shared query
function, with selective-failure fixtures for internal callers.
