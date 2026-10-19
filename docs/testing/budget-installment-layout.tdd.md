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
