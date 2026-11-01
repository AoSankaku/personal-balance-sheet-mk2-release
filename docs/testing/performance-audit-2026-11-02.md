# Calculation and data-loading audit — 2026-11-02

Scope: ordinary budget, journal, depreciation, and reconciliation reads following
placement preview optimization `15e615e`. This is an inspection report, not an
implementation of the proposed changes. Production data was not accessed.

## Measured database request growth

The actual Hono routes were executed against disposable in-memory SQLite using
the real migrations and the existing D1 adapter. A proxy counted prepared queries.
Response status, result counts, and snapshot book values were asserted. Fixture
creation queries were excluded. These counts establish query amplification;
local SQLite elapsed time does not predict remote D1 latency.

| Route and synthetic input | Prepared queries | Result size |
| --- | ---: | ---: |
| Trial-balance snapshots: 10 snapshots, one identical account/date each | 13 (10 balance aggregations) | 10 snapshots |
| Trial-balance snapshots: 100 snapshots, one identical account/date each | 103 (100 balance aggregations) | 100 snapshots |
| Journal: 100 two-line cash expense entries | 25 | 96,475 UTF-8 bytes |
| Journal: 1,000 two-line cash expense entries | 205 | 969,582 UTF-8 bytes |

Local reproduction: `bun run .tmp/auditSnapshotQueries.ts`; evidence is retained in
`.tmp/audit-snapshot-queries.log`. These ignored local artifacts are not included
in a fresh checkout. Input entries have fixed synthetic descriptions and JPY values;
production payload sizes depend on descriptions, allocations, tags, and other metadata.

## Recommended improvement order

### 1. Remove duplicate reconciliation reads and repeated snapshot queries

- `frontend/src/pages/TtPage.tsx:65`: snapshot loading guards only completed loads.
  The segment handler at 115 and effect at 102 can start the same request while
  the first is pending. `frontend/src/api/client.ts:853` does not deduplicate it.
- Credit-card state is fetched separately in `AppDataContext.tsx:597`,
  `TtPage.tsx:58`, and `components/tt/ActualInputSection.tsx:138`.
- `worker/src/routes/trialBalance.ts:81` awaits a balance aggregate for each
  snapshot/account. `/snapshots` at 336 loads the entire snapshot history.
  Identical account/currency/date combinations are still recalculated, as measured above.

First consolidate request ownership or share in-flight reads. Preserve explicit
reload after writes and the input form's protection for unsaved edits. Then batch
historical balance computation, or at minimum reuse equal account/currency/date
keys within the request. Test differing dates, debit/credit normal signs, currency
scales, adjustments, and snapshot deletion. Concurrently issuing every old query
would not eliminate the underlying work.

### 2. Index reset and depreciation data inside each budget computation

`worker/src/routes/budget.ts:1867` searches reset logs through
`worker/src/lib/budgetSummary.ts:66`, which filters all logs and sorts matching
resets. The category loop at 1907 and historical month loop at 1944 repeatedly
invoke that search, including another search from `spendingForMonth` at 1933.
The reservation filtering at 1883 and per-category calculation in
`budgetSummary.ts:304` also revisit whole collections.

For C categories, M months, L adjustment logs, and R reservations, prominent work
is approximately O(C × M × (L + R)), with additional sorting. This affects ordinary
summary reads and callers such as placement. Build request-local category/month
indexes once, sharing reset results between spending and funding calculations.
Preserve as-of cutoffs, same-day created-at ordering, economic-date exceptions,
reference exclusion, and reset cancellation. No speed multiplier has been measured.

### 3. Batch depreciation progress reads

`worker/src/routes/depreciation.ts:1585` serially awaits progress for every schedule.
`worker/src/lib/depreciationBudget.ts:766` loads logs separately per schedule;
an unset method can add purchase-line/account queries via 807 and 243. Schedule
count S therefore adds at least S queries, and commonly up to about 3S for unset
methods, with further reads possible for final resets.

Fetch relevant logs, resets, purchase lines, and accounts in bounded chunks and
calculate from maps. Preserve currency decoding, fallback purchase amounts,
paired receipts, and final-reset ordering. Query counts for this route are static
findings, not measured remote timings.

### 4. Index journal impacts for reconciliation calculations

`frontend/src/components/tt/DeviationSection.tsx:242` processes card/month rows.
Each calls helpers at 259 and 279; `ttUtils.ts:325` and 379 rebuild account maps
and scan the journal again. With K card/month rows and J journal lines, this is
approximately O(K × J), including older rows hidden later by the UI.

The candidate-matching calculation at `DeviationSection.tsx:367` separately scans
entries for each discrepant account and sorts matches. Index journal impacts by
account/currency and statement or withdrawal month. Reuse a shared account map.
Keep billing offsets, closing dates, refunds, repayment exclusions, cutoff dates,
matching tolerances, and ordering. Showing three initial matches does not authorize
discarding matches available through expansion. Locale-only label changes should
not require redoing financial arithmetic.

### 5. Avoid unconditional history reads in depreciation setup previews

`worker/src/lib/depreciationBudget.ts:659` loads all budget adjustment logs, and 663
loads legacy allocations, even when no special-method carry decision needs them.
Their use begins at 672 for `action === "carry" && method === "special"`.
The normal preview route reaches this from `worker/src/routes/depreciation.ts:508`.

Conditionally fetch these inputs when that branch is needed. Preserve the complete
history for carry cases until narrower filtering is proven equivalent. This is a
more localized change than altering financial recurrence or adding persistent caches.

## Larger changes requiring separate correctness gates

**Budget history prefix replay.** `worker/src/routes/budget.ts:1820` maps output
targets and repeats calculation from the earliest month to each target. `/history`
at 2168 supplies all requested months. For an M-month history, category/month work
is at least O(C × M²), before the repeated searches above. Advancing state once
chronologically could remove repeated prefixes. Monthly results must match existing
summary outputs, including ordinary/cash-basis balances, caps and overflow,
loan/lending returns, resets, and partial-month cutoffs. Indexing should come first.

**Whole-journal loading.** `frontend/src/context/AppDataContext.tsx:590` loads the
whole journal during initial/full refresh; `LedgerPage.tsx:503` filters it locally
and 659 slices only for display. `worker/src/routes/journal.ts:1073` reads every
entry and then retrieves related rows in chunks of 50. This explains the measured
query and payload growth. At 1109, tag metadata additionally reads journal lines
already retrieved at 1084 (`worker/src/lib/expenseTags.ts:187`). Reusing suitable
decoded/raw inputs could first eliminate that duplicate line read.

Route-specific loads, aggregates, and server pagination could bound the larger
cost. Simply paginating the shared journal would break calculations and task
detection that currently require full history. Inventory those consumers and
provide equivalent aggregate APIs before changing the shared data contract.

## Acceptance boundaries

The strongest low-scope candidates are duplicate request removal and request-local
indexes. Persistent financial caches need complete invalidation across all writes;
the existing budget revision alone does not cover every placement input. Adding
indexes blindly is also unwarranted: journal date/entry/account indexes already
exist. Any SQL index proposal should first be justified with its actual query plan.

No application source was edited, no server was started, and no production database,
deployment, or remote branch was modified during this audit.
