# Compact Overview presentation

## Direction

Preserve the existing Overview layout and financial calculations, while making remaining budget and usage easier to scan. Shorten repeated labels, show the usage numerator/denominator on one line, and put secondary financial explanations behind native disclosures.

The existing Impeccable design hook was enabled. Its `distill` and `clarify` guidance informed the refinement. Static detector checks of Overview's TSX/CSS before and after reported no findings; no suppression or hook configuration change was added.

## Changes

- Remove the repeated remaining balance beside the hero progress bar and the duplicate bottom ledger link.
- Use short Overview-specific labels in all six languages, keeping detailed terminology elsewhere.
- Fold monthly funding, reference spending, loan-funding badges, depreciation details, savings usage, and transaction allocations behind accessible disclosures. All original amounts and longer explanations remain available.
- Keep category balances, carryover/reset badges, usage progress and goal progress visible. Shorten goal forecasts without changing the prediction inputs.
- Add accessible date-navigation labels and visible keyboard focus for disclosures. Improve the contrast of secondary text within this page.

## RED

Checkpoint `851f652` (`test: capture compact overview presentation requirements`) captures the failing browser check: the hero's monthly-funding explanation was always visible.

The same synthetic fixture produced 1,023 non-whitespace characters in `main.innerText` at both desktop and mobile widths. No real account or financial data was used.

## GREEN verification

- Initial text fell to 446 characters for that fixture: approximately 56% less. This is a measured fixture result, not a claim about every user's data.
- `frontend/tests/overviewCompact.browser.mjs`: passed for exact remaining/usage balances, initially folded details, keyboard expansion, all category/savings/installment/allocation information, preserved links, all six languages, dark theme, and a 320px viewport without page overflow. No API writes or browser errors.
- Visually inspected before/after desktop and mobile captures, including dark mobile.
- Frontend TypeScript: passed.
- Targeted Overview loading, budget usage, integrity presentation, offline wiring and locale tests: 40 passed, 0 failed.
- Independent review found no concrete financial, loading, accessibility or responsive regression.
- The task-started Vite server was stopped. No production deployment or financial-data changes were performed.
