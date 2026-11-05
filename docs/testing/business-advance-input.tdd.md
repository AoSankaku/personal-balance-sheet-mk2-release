# Business advance input and budget consistency

Journeys were derived from the request: transfer personal funds to a business managed outside this ledger, use the business advance asset to track the balance, and record a fully business purchase without choosing a personal expense account.

## Budget behavior

- Sending budget resources consumes the selected category once; no selected category means unallocated funding.
- Sources outside the budget boundary produce reference history without active consumption.
- Recoveries replenish unallocated cash and never automatically restore a category, including after a reset.
- Disposals recognize an accounting loss without consuming a second budget. Legacy callers' allocations are canonicalized as references.
- Existing configured non-budget asset categories remain usable as business advance accounts.
- Pure transfers retain their selected category or unallocated choice on edit. Ambiguous mixed or multi-category entries use the compound editor to retain the saved allocation and exact amounts.
- Amounts and previews respect the selected currency's minor units. API capacity calculations sum storage integers per line.

## RED evidence

- `719648c`: API reproducer: 4 pass / 12 fail. UI reproducer: 1 pass / 2 fail (missing send mode and mandatory expense category at 100%).
- `23e798c`: edit reproducer: 10 pass / 4 fail, covering selected funding, unallocated funding, legacy accounts, and multiple-category preservation. Added helper specifications for business splits and outgoing/settlement payloads.
- `3a6aae5`: review reproducer: 16 pass / 1 fail for a large USD split and 14 pass / 1 fail for ambiguous mixed-entry editing.
- `d0aa1c8`: archived-source edit reproducer: 15 pass / 1 fail before the preservation guard.
- Same-day history regression: `BusinessAdvanceUi.test.tsx` had 3 pass / 1 fail before chronological tie-breaking, then 4 pass / 0 fail. Newest-first API responses no longer produce negative intermediate balances for a later recovery.

## Verification

| Guarantee | Test | Result |
| --- | --- | --- |
| Send, recovery, disposal, unallocated and excluded sources, legacy account categories, mixed personal/business, atomic create/edit/batch validation, USD precision and reset behavior | `worker/tests/businessAdvanceBudget.test.ts` | 17 pass |
| Ordinary expense, income and investment-sale budget boundaries remain valid | `bun test --coverage ./tests/businessAdvanceBudget.test.ts ./tests/journalBudgetAllocationLimits.test.ts ./tests/incomeBudgetScope.test.ts ./tests/journalInvestmentSaleBudget.test.ts` in worker | 48 pass |
| New scope helper coverage | Same command | 90.91% functions / 97.87% lines |
| Existing journal scope coverage | Same command | 97.14% functions / 96.23% lines |
| Currency precision, exact splits, required expense fields, excluded sources, invalid destinations, and final-cent balances | `bun test --coverage ./src/lib/businessAdvance.test.ts` in frontend | 11 pass; 100% functions / 96.77% lines |
| Business funding selection retained on edit, with safe fallback for unsupported histories | `frontend/src/components/SimpleEntryTransfer.test.tsx` | 16 pass |
| Send controls, optional expense selection only at business100, and chronological same-day history | `frontend/src/components/BusinessAdvanceUi.test.tsx` | 4 pass |
| Send/recover/dispose and a fully business purchase without expense selection, including USD 0.30 recovered as 0.20 + 0.10 | `node worker/tests/businessAdvance.browser.mjs` with isolated fixture and Playwright | Passed at desktop 1440px JPY and mobile 390px USD; zero page errors |
| Frontend type checking and production bundle | `bun run build` in frontend | Passed |

Targeted checks total 79 passing tests (48 API/regression, 11 helper, 16 transfer/edit, 4 component tests). All six locales provide the 11 new strings; YAML and UTF-8 without BOM checks passed. QA browser contexts and both task-owned servers were stopped after verification.

The browser fixture runs real routes against a disposable in-memory database (`worker/tests/helpers/businessAdvanceQaServer.ts`); it does not access local or production financial data. The browser script is `worker/tests/businessAdvance.browser.mjs`; supply the installed Playwright package via `PLAYWRIGHT_MODULE_PATH` and use a local frontend proxy targeting the fixture.

Worker-wide type checking encounters pre-existing errors in `moneyValidation.ts`, `admin.ts`, and a `bun:test` import in an existing test. The changed worker modules produce no diagnostics. No database migration is required.
