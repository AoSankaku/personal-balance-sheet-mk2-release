# Generic income transfer scheduling

## Accepted behavior

The user confirmed that budget allocations are finalized immediately; only the physical transfer between the receiving account and the budget's holding account is deferred. This applies to any income account, budget category, and amount.

- Income entry shows a defer checkbox when its allocation requires an account transfer. There is no interest-specific income-account or budget preset.
- Task management can defer an existing pending route or return it to ordinary tasks. Deferred items remain in a collapsed section and in existing netting/completion flows.
- Optional per-currency thresholds automatically defer small cumulative transfers for the same source, destination and currency, across all income/budget categories.
- `is_deferred=NULL` uses automatic rules, `1` forces deferral for any amount, and `0` explicitly restores an ordinary task even below the automatic threshold. Clearing automatic settings preserves manual choices.
- Editing restores the saved choice. Mixed route choices omit the override until the user explicitly changes it; the journal endpoint preserves prior choices by route/category/currency.
- Deferral changes metadata only. It does not move cash, change allocations, fabricate transfers, or complete requirements. Completed transfers cannot be deferred.

## RED / GREEN evidence

| Guarantee | Target | RED | GREEN |
| --- | --- | --- | --- |
| All incomes/budgets and large manual deferral | `frontend/src/lib/incomeTransferScheduling.test.ts` | Existing interest implementation: 1 pass, 5 fail; checkpoint `097288a` | Generic classification passes |
| Settings, migration, API flags, omission preservation, completed guards | `worker/tests/incomeTransferDeferral.test.ts` | Test-only checkpoint `23f143f`; null-setting assertion corrected in `51ca877` before implementation | 6 tests, 45 assertions pass |
| Explicit resume overrides automatic small-amount rules | `frontend/src/lib/incomeTransferScheduling.test.ts` | 7 pass, 1 fail; checkpoint `470abc9` | Explicit false overrides the automatic threshold |
| Immediate budgets plus deferred transfers still net correctly | `worker/tests/incomeTransferSchedulingFlow.test.ts` | Existing transfer/accounting mechanisms reused | Allocation, cash, preview, and completion invariants pass |
| Real input, manual toggles, edit preservation and disabled automatic rules | `worker/tests/incomeTransferScheduling.browser.mjs` | Browser acceptance coverage | Headless Chromium at 1440px and 390px passes |

## Verification

- Frontend targeted tests: 27 pass across scheduling, budget-scope forms/helpers, and income section.
- Worker targeted tests: 27 pass across generic deferral, end-to-end accounting/transfer API flow, existing transfer/netting, income budget scope, and legacy settings compatibility.
- Frontend TypeScript + Vite + PWA build: pass.
- Worker-wide TypeScript diagnostics: 112 before and 112 after, with zero additions in a compiler-host comparison against `d58ffe9` (comparison ignores line shifts).
- Independent review found no concrete required fixes.
- New append-only `0018_income_transfer_scheduling.sql` preserves legacy columns and copies legacy thresholds into generic settings. It ran against disposable test databases and local D1 successfully. Production migration/deployment was not performed.

To repeat browser checks, run `bun tests/helpers/incomeTransferSchedulingQaServer.ts` from `worker`, redirecting request logs to a temporary file. Reuse or start Vite, then run `node worker/tests/incomeTransferScheduling.browser.mjs <playwright-package-path>` from the repository root. `TRANSFER_QA_UI_URL` and `TRANSFER_QA_API_URL` select endpoints. The browser checks the isolated marker before mutations and intercepts all app API calls to the synthetic in-memory database. Stop the temporary API after checking; do not stop a reused development server.

The historical interest-specific verification record remains in `interest-income.tdd.md`; its UI and test paths describe revision `d58ffe9`, not the current generic feature.
