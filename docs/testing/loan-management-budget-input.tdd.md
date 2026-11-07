# Loan management budget input

## Intended behavior

Derived from the request to enter budget allocations directly from loan management:

- Long-term collection and repayment open the shared budget-aware entry form inside the detail page.
- The principal budget breakdown is discoverable before entering the amount or cash account.
- Lending interest uses the normal income budget distribution; borrowing interest uses the normal expense budget distribution.
- Saving preserves explicit principal funding, expense/income allocations, transfer destinations, and the selected currency.
- Failed saves retain the draft. Pending saves cannot be dismissed and reopened to create duplicate entries.

Long-term principal allocations remain explicit per entry. The form explains that the original funding split is not copied automatically and that the remainder is unallocated. Source-linked short-term settlement and write-off behavior continues to use the saved source split.

## RED / GREEN evidence

- RED checkpoint: `d17bbae` (`test: cover budget input from loan management`). The new component test could not load the missing loan-management workflow component.
- GREEN: `bun test frontend/src/components/LoanManagementEntryForm.test.tsx frontend/src/components/entry/LoanSection.test.tsx frontend/tests/budgetFundingAllocation.test.ts` — 13 passing tests, 0 failures.
- Frontend production build: `cd frontend` then `bun run build` — passed. Build reports chunk-size and Browserslist freshness warnings.
- All six supported locale files contain the manual-settlement explanation, with a registered translation key.

## Browser verification

`worker/tests/loanManagementBudget.browser.mjs` runs the real UI and Worker routes against a new in-memory SQLite fixture, without using project D1 data. The fixture server is `worker/tests/helpers/loanManagementBudgetQaServer.ts`.

With an available local Playwright or Playwright Core module:

1. Run the fixture server with Bun (default port 18787).
2. Run Vite on loopback port 15173 with `--strictPort`.
3. Run `node worker/tests/loanManagementBudget.browser.mjs <playwright-module-path>` from the repository root.
4. Stop both servers after verification.

| Scenario | Evidence |
| --- | --- |
| JPY, 1440px and 390px | Collection, repayment, interest income, and interest expense saved; category balances changed by the exact selected amounts |
| USD, 1440px | The same four flows retained USD and decimal amounts |
| Principal saved record | The selected budget category and currency survived a journal reload |
| Failed POST, JPY desktop | Budget unchanged; category input retained for retry |
| Delayed POST, JPY desktop | Submit disabled, Escape ineffective, close control hidden, exactly one POST |
| All browser scenarios | No uncaught page errors |

Screenshots and detailed logs are kept under the ignored `.tmp/loan-management-budget/` directory. The browser and both task-started servers were stopped after verification.

An independent review identified the pending-save dismissal race; the save-state guard corrected it, the delayed-save scenario passed, and a focused follow-up review accepted the fix.
