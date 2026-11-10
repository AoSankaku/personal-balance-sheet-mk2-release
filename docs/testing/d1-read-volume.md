# D1 read-volume regression checks

Database read volume is an acceptance criterion alongside financial result
correctness. Measure executed queries and `meta.rows_read`; elapsed time and
returned row counts do not measure D1 scan cost.

## Run

From `worker`:

```sh
bun run test:db-reads
```

The runner bundles actual route modules, uses Wrangler's local platform proxy,
applies the real migrations to an isolated nonpersistent D1 database, and inserts
synthetic data. Its generated config has a placeholder database ID and loads no
project environment files. It never opens the regular local D1 or production DB.
The platform proxy and temporary files are disposed after execution. A restricted
environment may need permission to start workerd and bind a loopback socket.

## Acceptance cases

| Area | Correctness | Read-volume gate |
| --- | --- | --- |
| Budget summary pair | Both complete results equal the existing separate endpoints; today and month-end spending differ | At most 65% of the separate routes' combined queries and rows read |
| Entry/currency lookup | Same selected journal lines before and after migration | At most 250 reads for 38 IDs, less than one quarter of baseline, and stable after adding 2,000 unrelated same-currency lines |
| Journal adjustment logs | Every 50-entry chunk returns 50 matching logs | At most 1,900 reads across 12 chunks, below 35% of unindexed scan cost |
| Depreciation links | Correct 3 matches out of 300 links | At most 12 reads |
| Account balances | Actual route agrees with the previous aggregate | Entire route reads less than 80% of the old aggregate alone |

The baseline fixture has 600 balanced two-line expense entries (1,200 lines),
600 budget allocations, 600 linked adjustment logs, and 300 depreciation links.
It intentionally puts every line in JPY to detect a currency-only index scanning
all rows. Fixture setup and migration work are excluded from read measurements.

The local D1 counter comes from workerd's SQLite cursor. For read-only routes,
the harness records SQL executions and replays the same SELECTs with unchanged
bindings against unchanged fixtures to obtain `meta.rows_read`. This also covers
`first()` and `raw()`, whose public results omit metadata. Replays are excluded
from request query counts. These are real local counters, not estimates from SQL
text, EXPLAIN plans, JavaScript loops, or SQLite VM instructions. Production
SQLite versions, statistics, and data distributions can produce different counts.

## Verified on 2026-11-10

All five local D1 read-volume cases passed:

| Measurement | Before | After |
| --- | ---: | ---: |
| Budget pair rows read | 11,452 | 5,726 |
| Budget pair executed queries | 28 | 14 |
| 38-entry line lookup rows read | 1,200 | 152 |
| 12 journal log chunks | 7,200 unindexed scan baseline | 1,799 |
| Account balances | 3,600 for old aggregate | 2,432 for entire optimized route |

`budgetSummaryPair.test.ts` covers endpoint parity and date fallback with resets
and currency isolation. `accountBalanceReads.test.ts` covers all account normal
sides, storage precision, historical cutoffs, empty and completed accounts.
Frontend summary-pair tests cover request sharing, cache reuse and invalidation,
including writes overlapping pending reads.

Targeted verification passed 65 backend tests and 17 frontend tests, in addition
to the five workerd read-volume tests. Frontend typecheck/build and Worker
deployment dry-run passed. Worker-wide TypeScript still reports pre-existing
diagnostics in unrelated files/dependencies; it reports none in the changed
production files. Independent review findings about overlapping writes, old
single-summary cache responses, duplicate post-save fetches, and dedicated-test
discovery were resolved before acceptance.

The new `0024_read_query_indexes.sql` is append-only. Production application of
the migration still requires the project's full snapshot and restoration gate.
These tests do not apply any production migration or deploy an application.
