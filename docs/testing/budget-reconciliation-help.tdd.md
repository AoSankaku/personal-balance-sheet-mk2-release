# Budget reconciliation guide and contextual help

## User journey

Read a short explanation beside a budget calculation, then open the corresponding guide section without searching the chapter. Support hover, keyboard focus/Enter, and touch. Keep chapter selection and the target stable across reloads, back navigation, and all six supported languages.

## RED

- Checkpoint: `f34f63b` (`test: capture missing budget reconciliation guide targets`).
- `bun test frontend/tests/budgetReconciliationHelp.test.tsx`: 0 passed, 2 failed.
- The existing guides had no stable reconciliation/glossary anchors and no worked example distinguishing net reconciliation, overspending, funding, and placement.

## GREEN

- Added question icons with short localized tooltips and direct links for the three funding cards, seven detailed calculation rows, overspending, and placement surplus/shortage.
- Added explicit Markdown heading anchors and URL chapter selection. Invalid chapter/hash inputs fall back safely; ordinary mobile chapter navigation still scrolls to the page top.
- Documented C, N, P, O, R, D, G, A, S, and F, their formulas and signs, the already-counted purchase reservation, current zero reference reserve, liability deductions, time/currency scope, and excluded-cash transfers.
- Added matching explanations and identical anchor IDs in Japanese, English, French, Spanish, Simplified Chinese, and Traditional Chinese.
- The worked example is synthetic. No production financial data is stored in the tests or guide.

## Verification

`bun x tsc --noEmit -p frontend/tsconfig.json`

`bun test frontend/tests/budgetReconciliationHelp.test.tsx frontend/tests/guidesPageScroll.test.ts frontend/tests/i18nTranslations.test.ts frontend/tests/tt-budget-check.test.ts frontend/tests/budgetPlacementReconciliationUi.test.ts frontend/src/lib/allocatableBudget.test.ts --coverage --coverage-reporter=text`

- 27 passed, 0 failed, 8,010 assertions.
- New guide navigation and help-link helpers: 100% function and line coverage.
- Headless Chromium: `frontend/tests/budgetReconciliationHelp.browser.mjs`, accepting an installed Playwright package path and an existing Vite base URL as arguments.
- Browser checks passed for stable hover/focus explanations, real Tab/Enter navigation, touch links, anchored scroll below the fixed header, reload/back navigation, six languages, invalid URL input, mobile chapter-top behavior, and no mobile page overflow.
- All API responses in the browser check are synthetic; no API writes or browser errors occurred in the passing run. The task-started Vite server was stopped.
- Independent review checked formulas against the implementation. Corrected the placement explanation to refer to proposed balancing transfers and clarified the French instruction against deducting purchase reservations twice.

No accounting calculations or financial records were changed by this feature. No production deployment was requested for this change.
