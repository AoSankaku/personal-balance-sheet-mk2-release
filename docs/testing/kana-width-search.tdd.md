# Kana width insensitive search

Journeys were derived from the request to find the same text using half-width or
full-width katakana, while retaining original descriptions and option labels.

| Guarantee | Evidence |
| --- | --- |
| Matching works in either direction, including voiced/semi-voiced marks, small kana, long vowels, and mixed-width marks | `frontend/src/lib/searchText.test.ts` |
| Existing case-insensitive substring matching remains; hiragana, voiced/unvoiced kana, and unrelated compatibility symbols stay distinct | Same test file |
| Dropdown filtering preserves original values, labels, disabled state, metadata, groups, ordering, trimming, and limits | `frontend/src/lib/searchOptionsFilter.test.ts` |
| Select, MultiSelect, Autocomplete, and TagsInput share the search defaults | Same test file, using the application theme |

The ledger uses the same matcher for displayed results and the count outside the
selected date range. Normalization applies only to comparisons. Half-width kana in
the test fixtures are intentional UTF-8 text.

RED checkpoint: `d53e062`. Running the two new search test files before the helper
and theme modules existed failed to resolve those not-yet-implemented modules
(0 passed, 2 errors). This was a compile-time RED; it did not execute the test cases.

GREEN/coverage command:

```text
bun test frontend/src/lib/searchText.test.ts frontend/src/lib/searchOptionsFilter.test.ts frontend/tests/accountSelectOptions.test.ts frontend/tests/ledgerDateRangeLayout.test.ts --coverage --coverage-reporter=text
```

Result: **26 passed, 0 failed, 91 assertions**. The new search helpers and theme
have **100% function and line coverage** in this run.

`bun x tsc --noEmit -p frontend/tsconfig.json` passed. No database migration or
server/browser process was required for this frontend comparison change.
