# Interest income allocation and deferred placement

Historical record for `d58ffe9`. The current feature is generic; see [income transfer scheduling](income-transfer-scheduling.tdd.md) for current behavior and verification commands.

## Behavior

- Settings binds an explicitly selected interest income account to a default budget category (for example, free spending). IDs are used; account/category names are not inferred.
- The normal income form initially assigns the full amount. A manual allocation edit disables the default. Existing edited entries and restored explicit distributions are preserved; the default can be explicitly reapplied.
- Income and budget allocation are saved immediately through the existing journal API. Cash remains in the receiving account until a real transfer is recorded.
- Existing pending income-transfer requirements are classified for display. Small interest totals below the configured threshold for each directed account pair and currency are deferred. The exact threshold is actionable; an unspecified/zero threshold keeps normal visibility.
- Deferred requirements remain available in the task page's accordion, existing netting preview/completion, and per-account reconciliation counts. No additional budget reservation or fictional transfer is created.
- Disabling a currency removes only its threshold on the next settings save, preserving other enabled currencies.

## RED / GREEN evidence

| Guarantee | Regression target | RED evidence | GREEN evidence |
| --- | --- | --- | --- |
| ID-based default; small/cumulative/separate-currency task classification | `frontend/src/lib/interestIncome.test.ts` | Missing implementation module; test checkpoint `0756fe1` | 10 helper/summary tests pass; helper and summary function/line coverage 100% |
| Persist nullable rule, preserve partial updates, validate IDs/currency precision | `worker/tests/interestIncomeSettings.test.ts` | API assertions failed before implementation; checkpoint `4df1278` | 2 tests / 17 assertions pass |
| Save after disabling a currency | `frontend/src/lib/interestIncome.test.ts` | Runtime RED: 9 pass / 1 fail (missing threshold-pruning function); checkpoint `b2e876f` | 10 pass / 0 fail |
| Immediate budget increase, unchanged physical placement, deferred tasks still nettable | `worker/tests/interestIncomeTransfers.test.ts` | Existing accounting/transfer mechanisms reused | Real API: 112 + 122 budgeted immediately; receiving account +234, target account unchanged; both pending; existing squash later records 234 and completes both |
| Input default, manual override, deferred access, exact cumulative threshold | `worker/tests/interestIncome.browser.mjs` | New end-to-end acceptance coverage | Headless Chromium at 1440px and 390px passes |

## Verification

- Frontend targeted tests: 27 passed across interest helpers, normal/bulk budget-scope components, and the income section.
- Worker targeted tests: 21 passed across settings, interest transfers, existing transfer/netting functions, and income budget-scope endpoints.
- `frontend/bun run build`: passed (TypeScript, Vite, PWA).
- Worker-wide TypeScript checking has 112 diagnostics. A compiler-host baseline comparison against `a5399ae` produced the same 112 diagnostics and zero additions; neither changed Worker source file has diagnostics. Targeted API tests pass.
- Independent review found the disabled-currency settings issue; fixed and re-reviewed without additional concrete findings.
- Migration `0017_interest_income_rule.sql` adds one nullable settings column. Real migration SQL ran in isolated test databases and the local D1 migration succeeded. Production migration/deployment was not performed.

To repeat the browser acceptance check, run `bun tests/helpers/interestIncomeQaServer.ts` from `worker` (redirect request logs to a temporary file), reuse or start Vite, then run `node worker/tests/interestIncome.browser.mjs <playwright-package-path>` from the repository root. Optional `INTEREST_QA_UI_URL` / `INTEREST_QA_API_URL` select the test endpoints. The script checks the isolated API marker before mutations and intercepts all application API requests to that endpoint. Stop the test API after verification.

The end-to-end test uses synthetic records only. Production entries, historic allocations, and real bank balances are not rewritten. A missing source entry or non-interest/mixed-income entry retains ordinary task visibility.
