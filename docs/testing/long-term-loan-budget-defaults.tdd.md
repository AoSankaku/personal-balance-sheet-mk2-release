# Long-term loan budget allocation defaults

## Behavior

Derived from the request to keep configurable repayment/collection defaults aligned with the first long-term borrowing/lending allocation:

- Settings are scoped by loan account and currency. Without an override, the earliest opening's saved funding amounts provide exact integer weights, including unallocated principal. Later openings do not replace that default.
- The long-term detail page edits integer ratios, saves an override, or resets to the first opening. Settings changes never rewrite existing journal entries or budget balances.
- Simple and compound entries apply defaults to the principal and recalculate automatic amounts when the principal changes. Explicit per-entry overrides and saved-entry edits remain manual; draft state preserves this distinction.
- Archived categories retained by a default remain visible and labeled. Missing or ambiguous original allocation data is explicitly unavailable/unallocated rather than inferred from a later opening.
- Missing or ambiguous past settlement attribution prevents guessing its rounding state. The user can explicitly choose a manual allocation.

## Rounding and concurrency

Weights remain exact integer ratios rather than rounded display percentages. Allocation uses BigInt products and currency minor units, with largest remainders and deterministic category-ID ties (unallocated last).

For installments, the server recognizes the latest consecutive settlement sequence matching the current default. The next cumulative target is compared with that recorded allocation, and the current principal is split across positive deficits. This prevents repeated one-unit payments from always favoring one category. A known manual or old-ratio deviation starts a fresh sequence without rebalancing that past entry. Unknown attribution clears the known carry state.

Example: an opening funded by A1/B1 and collected in two one-yen installments returns A1 first and B1 second. Tests also cover a six-category ratio whose largest-remainder targets are not monotonic.

Default reads use coherent source/settlement queries and verify a stable budget revision. Automatic submissions carry that revision and their account IDs. Journal creation checks it before the existing atomic mutation guard, so two clients cannot save the same stale rounding state. A stale response retains the form, reloads defaults, and requires another explicit save. Same-account automatic snapshots cannot be reused within one bulk request.

Amounts that cannot round-trip through the numeric API without losing a minor unit are rejected rather than silently rounded incorrectly. The previous floating-point rejection of a 0.30 principal split as 0.10 + 0.20 is fixed.

## RED evidence

- `8427690`: tests reproduced the missing ratio allocator and the 0.30 floating-point over-allocation failure.
- `fe91605`: client methods and API routes were missing; the new request tests failed on those missing paths.
- Later focused regressions reproduced missing installment carry and missing snapshot revision support before their implementation.

## GREEN evidence

100 focused tests passed across these separate commands; no full repository suite was run:

| Check | Result |
| --- | --- |
| `bun test shared/longTermLoanBudgetDefaults.test.ts frontend/tests/budgetFundingAllocation.test.ts` | 27 passed |
| `bun test worker/tests/longTermLoanBudgetDefaults.test.ts` | 19 passed |
| From `frontend/`: `bun test src/api/loanBudgetDefaults.test.ts src/components/entry/LoanSection.test.tsx src/components/LongTermLoanBudgetDefaultsEditor.test.tsx src/components/LoanManagementEntryForm.test.tsx src/components/MultiLineIncomeBudget.test.tsx` | 21 passed |
| `bun test worker/tests/journalBatchParity.test.ts worker/tests/journalBudgetAllocationLimits.test.ts` | 33 passed |
| From `frontend/`: `bun run build` | Passed |
| From `worker/`: Wrangler `deploy --dry-run` using the local config | Passed; no deployment |
| Local D1 migration | `0023_long_term_loan_budget_defaults.sql` applied successfully |
| Encoding and diff checks | UTF-8 without BOM; no mojibake markers; whitespace check passed |

The backend tests include missing-first-source handling, chronological source selection, USD amounts, component-only principal, category deletion, more than 100 category parameters, exact carry, backdated insertion, manual boundaries, coherent reads, and stale single/bulk requests with no partial writes.

## Headless browser evidence

The real UI and Worker routes used only a disposable in-memory D1 fixture. `worker/tests/helpers/loanBudgetDefaultsQaServer.ts` serves it; the scripts accept a local Playwright module path as their first argument.

| Script | Verified |
| --- | --- |
| `worker/tests/loanBudgetDefaults.browser.mjs` | JPY desktop/mobile and USD desktop; first-opening defaults, amount recalculation, one-entry manual override, custom save/reload/reset, unchanged ledger on settings edits, archived categories, and decimal 0.30 saved as 0.10/0.20 |
| Same script, JPY | Concurrent external one-yen collection makes the open form stale; its save is rejected, its input remains, and a reviewed retry releases the other budget's final yen |
| `worker/tests/loanBudgetDefaultsCompound.browser.mjs` | Multiple long-term accounts aggregated correctly; snapshot submitted; stale response from under-budget confirmation recovers without an unhandled rejection or draft loss |

All browser scenarios had zero uncaught page errors. Screenshots and logs are in the ignored `.tmp/loan-budget-defaults/` and `.tmp/loan-defaults-*` paths. Task-started browsers and servers were stopped after verification.

Independent review findings about source-read atomicity, installment remainders, archived-category visibility, concurrent submissions, and confirmation-path error recovery were corrected and rechecked.

## Existing verification limitations

The broader D1 sync-order test already fails at baseline `da1541e` because eight older application tables are absent from its fixed import list. The new configuration tables are included in dependency order; unrelated sync behavior was left untouched. Baseline evidence is recorded locally in `.tmp/loan-defaults-baseline-sync.json`.

Worker-wide TypeScript checking also reports existing dependency and source diagnostics outside the changed paths (money validation, admin/crypto, income-transfer requirements, and long-term plan handling). The changed backend paths have no reported diagnostics; the Worker bundle and the real D1/router tests pass. Frontend TypeScript/build checks pass.

Only the local database was migrated. Production deployment requires the repository's full remote backup/restore verification procedure before applying migration 0023.
