# Budget funding and income-transfer TDD evidence

## Scope

- Loan/lending principal consequence (`apply` / `component_only`)
- Reset-boundary behavior
- Multi-line journal funding components
- Consequence-based reconciliation
- Income-linked account-transfer requirements and historical matching

## Red

The new tests were executed before their implementations:

- `worker/tests/budgetFundingImpact.test.ts` failed because
  `budgetFundingImpact.ts` did not exist.
- `worker/tests/incomeTransferRequirements.test.ts` failed because the
  grouping, exact-transfer matching, and placement-graph helpers did not
  exist.
- `frontend/tests/incomeTransferTasks.test.ts` failed because the task API and
  ledger UI were absent.
- `frontend/tests/multiLineBudgetFunding.test.ts` failed because the prior
  rounding assigned `0.02 / 0.03` instead of the smallest-unit-preserving
  `0.01 / 0.02` applied split.
- `worker/tests/budgetFundingWiring.test.ts` failed before journal-line
  consequence validation was wired.

## Green

Targeted verification after implementation:

- Worker funding impact/reset/transfer helpers: 14 passing.
- Worker funding persistence and line-consequence validation: 15 passing.
- Frontend funding completeness, task UI, and multi-line funding: passing.
- Six-locale translation completeness: 4 passing with 5,507+ key assertions.
- Local D1 schema inspection confirmed `effect`, its index/check, and
  `income_transfer_requirements` with amount/completion constraints.

## Full regression and build

- Worker: `bun test` — 108 passed, 0 failed.
- Frontend (run from repository root for path-dependent tests):
  `bun test frontend/tests frontend/src` — 383 passed, 0 failed.
- Frontend: `bun run build` — TypeScript and Vite production build passed.
- Worker: `bun run build` with a valid dry-run D1 ID — Wrangler dry-run passed.

No production/remote migration was run as part of these checks.
