# P&L expense chart tag filter

## Reproduction and RED

The P&L page filtered its totals and account tables by selected expense tags, but passed no tag selection to the monthly expense chart. The chart therefore continued to aggregate the full journal.

Checkpoint `c2d8610` (`test: reproduce tag filters missing from expense chart`) records three failing regression tests for selected-tag history, multiple-tag deduplication and clearing/unmatched filters.

## Change

- Pass the selected tag IDs from P&L to the shared expense chart.
- Build display buckets with the existing any-selected-tag matching rule. Each matching journal entry is counted once.
- Preserve the chart's independent date range and currency handling.
- Keep the unfiltered snapshot for the shared persisted expense history; filtering the chart must not overwrite the all-entry cache.

## Verification

- `bun x tsc --noEmit -p frontend/tsconfig.json`: passed.
- `bun test frontend/src/lib/expenseHistoryStorage.test.ts frontend/src/lib/expenseTagSummary.test.ts frontend/tests/displayCurrencyAmounts.test.ts`: 14 passed, 0 failed.
- `frontend/tests/plExpenseTags.browser.mjs`: passed against a local Vite instance using synthetic API responses. Selecting a tag changed the actual November bar tooltip from 10,000 to 1,000; removing it restored 10,000. October remained in the chart even though P&L showed November. The persisted history still contained all three entries and the unfiltered 10,000 November total.
- No API writes or browser errors occurred. The test-started server was stopped. No production data was changed.
