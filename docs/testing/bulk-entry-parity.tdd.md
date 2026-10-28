# Bulk entry parity with normal input

Journeys and acceptance criteria were derived from the request to repair bulk loan
budget funding, income transfer scheduling/deferral, and foreign-currency input.

## Acceptance criteria

- Each bulk income/discount row retains its independently selected income account,
  budget category, physical transfer destination and deferral choice. Budget-deducted
  cards receive budget allocations without physical cash-transfer requirements.
- All money fields use the selected currency and its configured smallest unit.
  Expense allocations conserve cents and keep existing integer-JPY behavior.
- A bulk loan row uses the existing normal loan form, including all four directions,
  principal funding, whole-opening settlement selection and any settlement difference.
  Stale or unconfigured loan drafts cannot be silently posted as ordinary expenses.
- Normal and bulk journal creation share validation and persistence preparation.
  An invalid later row cannot leave earlier rows saved. Duplicate, stale or inconsistent
  opening-settlement references cannot restore the wrong funding or settle twice.
- Recording journals followed by a failed statement-completion update cannot invite
  reposting journals that were already saved.

## RED evidence

On `dev`, before production changes:

```text
bun test frontend/src/lib/bulkEntrySubmission.test.ts
2 passed, 8 failed

cd worker
bun test tests/journalBatchParity.test.ts
3 passed, 2 failed
```

The frontend failures exercised the missing submission builder and demonstrated
currency-cent allocations being rounded to integer amounts. The API failures
demonstrated invalid later rows being skipped/saved partially and one opening being
settled twice. Checkpoint: `6241d8f`.

A further regression reproduced normal card repayment being rejected by the new
bulk loan builder: 10 passed, 1 failed. Its fix retained normal card semantics and
passed the same test. Checkpoints: `fe28c16`, `c233c8d`.

## Verified shared helpers

- Bulk assembly and income scheduling use `buildBulkJournalEntries` and
  `buildIncomeBudgetEntryFields`; the existing income eligibility helper remains
  compatible for other callers.
- Currency precision is optional in the common normal/bulk distribution functions,
  defaulting to the previous integer behavior for unchanged callers.
- Focused helper coverage: 14 passed, 0 failed; bulk builder 100% lines and 84.21%
  functions, income budget scope 98.41% lines and 100% functions. Other imported
  modules in the coverage output contain unrelated pre-existing functions and are
  not represented as having equivalent coverage.

## Final verification

- Frontend production build (`cd frontend && bun run build`) passed, including
  TypeScript. A sandbox-only Bun working-directory failure was resolved by running
  the same command with normal local process permissions.
- Shared submission, income scope, normal-form budget scope, existing distribution
  regressions and builder-to-API integration: 45 tests passed across five files.
- Worker journal batch, accounting integrity, income scope, transfer deferral and
  allocation-limit regressions: 65 tests passed. Worker TypeScript still reports the
  existing 112 diagnostics; none are in the changed route or new batch test.
- An isolated in-memory fixture served the production frontend bundle to headless
  Chrome, with service workers disabled and external requests blocked. Both 1440px
  and 390px widths saved a USD 25.55 expense, USD 5.15 deferred income and a
  source-linked USD 20 repayment in one batch. Budget availability changed from
  USD 120 to USD 79.60; the JPY cash balance remained unchanged. A normal manual
  USD 4.25 income then produced USD 83.85, preserving its fractional allocation.
- Additional actual UI flows saved all four loan directions together, checked the
  resulting account and budget balances, saved independent deferred/resumed income
  choices, and verified that currency/payment-account changes invalidate prepared
  loan inputs and clear stale opening selections.
- The browser flow exposed a normal-form foreign-currency loan bug: assembled
  lines lacked currency until after funding impact calculation. The form now tags
  the complete direction/difference line set before calculation and submits those
  same lines. A focused regression and the repeated actual USD flow pass.
- A final regression reproduced raw subtraction returning
  `0.00999999999999801` for USD 20.02 minus USD 20.01. The previous `0.01`
  threshold could discard that difference. A shared minor-unit difference helper
  now drives the normal/bulk form submission and preview. Its test passed after
  the demonstrated failure, including positive/negative cents, floating residue,
  three-decimal and eight-decimal currencies. Actual normal and bulk UI flows both
  saved USD 20.02 cash against USD 20.01 principal and USD 0.01 budgeted expense;
  both yielded USD 99.99 available budget.
- Independent review reproduced and resolved a settlement scope bug: opening
  category/source proportions must be preserved while apply/component-only effects
  are recalculated from the settlement's current cash scope. Both tracked-to-excluded
  and excluded-to-tracked cases pass. Transactional source-state guards, duplicate
  sources, stale funding snapshots, legacy source-ID-only settlements and same-settler
  edits were also reviewed and covered by targeted API tests.
- Diff whitespace and UTF-8-without-BOM checks passed. The isolated server and
  headless browser processes were stopped after verification.

Detailed execution logs and screenshots remain in the ignored `.tmp/bulk-parity/`
directory. All verification used synthetic data. No production data, schema,
deployment or remote Git branch was changed by this task.
