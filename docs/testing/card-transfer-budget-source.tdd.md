# Budget sources for card-funded transfers

Journeys were derived from the report that the simple transfer editor had no
budget-source choices when a credit card funded an excluded cash account.

The source selector previously used only the source account's connected holding
group. Credit cards cannot be budget holding accounts, so their group was empty.
For card sources, offer all supplied active budget categories in their usual sort
order. Keep cash-source grouping and destination-account grouping unchanged.
Budget movement remains optional and no category is selected automatically.

| Guarantee | Evidence |
| --- | --- |
| Cards can use any supplied budget category without a holding-account link | `frontend/tests/transferBudgetMovement.test.ts` |
| Cash sources retain connected-group restrictions; missing/non-card unlinked sources do not gain unrestricted choices | Same test file |
| Destination choices remain scoped to the receiving account; excluded cash has no destination category | Same test file |
| The actual transfer form displays a saved card-funded budget source | `frontend/src/components/SimpleEntryTransfer.test.tsx`, using server-rendered Mantine form markup |
| A selected budget decreases once, edits replace the prior adjustment, and card/cash amounts plus billing offsets round-trip correctly | `worker/tests/creditCardTransferBudget.test.ts`, using disposable migrated SQLite and the real Hono routes |
| Leaving the budget source empty keeps budgets unchanged through creation and editing | Same integration test file |

RED command:

```text
bun test frontend/tests/transferBudgetMovement.test.ts frontend/src/components/SimpleEntryTransfer.test.tsx
```

Result: **25 passed, 3 failed**. Failures reproduced empty card source choices and
the actual form's inability to display a saved source. Checkpoint: `cfcca3f`.

GREEN/coverage command:

```text
bun test frontend/tests/transferBudgetMovement.test.ts frontend/src/components/SimpleEntryTransfer.test.tsx worker/tests/creditCardTransferBudget.test.ts --coverage --coverage-reporter=text
```

Result: **30 passed, 0 failed, 80 assertions**. `transferBudgetMovement.ts` had
100% function and 98.85% line coverage. The uncovered line is the existing name
tie-break sort. Frontend TypeScript passed with
`bun x tsc --noEmit -p frontend/tsconfig.json`.

No migration, production data update, development server, or browser process was
required. Integration writes were confined to disposable in-memory databases.
