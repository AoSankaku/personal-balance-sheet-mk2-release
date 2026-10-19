# Budget installment transfer input layout

## Intent

Organize the expense entry's budget installment transfer form around purchase/payment, monthly expense, and budget handling. Keep existing accounting calculations, manual allocation editing, and confirmation requirements intact. Related purchase/monthly fields share a desktop row and stack in that order on mobile. Zero-value budget rows and detailed explanations are disclosed on demand.

## RED

- Browser regression: `worker/tests/budgetInstallmentLayout.browser.mjs`.
- Uses the existing Vite server with every actual `/api/` request forwarded to an isolated in-memory QA API on port 18787. The real local database is never used.
- Tested at 1440px and 390px, with named field groups, responsive ordering, zero-row visibility, overflow, and browser error checks.
- Initial runtime result: `AssertionError: Purchase/payment inputs need one named group` (`0 !== 1`). Log: ignored `.tmp/installment-layout/red.log`.
- Before screenshots captured at both widths. Amount and payment fields currently follow budget settings, all method descriptions remain expanded, and allocation inputs lack aligned column headings.

## Verification intent

- Run frontend typecheck/build first, then the targeted headless browser regression.
- Inspect the resulting desktop/mobile screenshots and verify manual ratio/amount editing, disclosure controls, method order, and required warnings.
- No database migration or production deployment is required for this presentation change.

## Review regression RED

The independent review identified that Mantine `Radio.Card` calls the method-change handler when the already selected card is clicked. This cleared explicit monthly-unallocated consent. The browser regression reproduced `false !== true` for `Clicking the selected method preserves confirmed monthly unallocated use` before the handler guard was added. Log: ignored `.tmp/installment-layout/consent-red.log`.

Mantine Collapse retains clipped, inert children. Visibility assertions therefore verify the closed panel's `aria-hidden` and zero height rather than `Locator.isVisible()`, which does not account for opacity or ancestor clipping.

## GREEN

- `frontend/bun run build`: TypeScript, Vite, and PWA build succeeded after the final layout changes.
- Targeted frontend tests: 26 passed, 0 failed, 1,073 assertions across monthly-source helpers, form validation, and six-language feature copy.
- `budgetInstallmentLayout.browser.mjs`: passed at 1440px and 390px, with three named groups, desktop/mobile ordering, no horizontal overflow, method order, zero-row/help disclosures, purchase warning, manual ratio/amount changes and rounding, default restoration, unallocated consent, same-card reselection, card billing-offset reset, business-advance fields, and ordinary-expense mode. Browser exceptions: 0.
- The existing `depreciationBudgetSources.browser.mjs` ran through an ignored temporary adapter that routed requests to the same isolated port 18787. Repair previews, dated splits, account changes, odd-yen rounding, new purchase save, and saved-split restoration all passed. Browser exceptions: 0. No real D1 database was opened.
- Desktop/mobile screenshots were inspected. The installment form is limited to 1040px, purchase/monthly inputs share a desktop row, method descriptions sit below compact choices, and the aligned share editor is limited to 660px. Secondary details follow the inputs.
- Independent review found the same-card consent issue recorded above; the added handler guard now passes the browser regression.
- No schema migration, remote push, or production deployment was performed.
