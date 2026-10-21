# Compound income and investment sale budget allocation

## Accepted behavior

- A compound receipt saves income allocation through income budget adjustments, separately from expense consumption.
- An investment sale can allocate the full received proceeds. The recognized gain is income allocation; the recovered principal is an allocation from returned unallocated resources.
- Existing compound allocations recorded as positive expense reductions are restored in the editor and converted on explicit save without double counting.
- Reopening and saving preserves income allocation and compatible account-transfer requirements, including completed-transfer protections.
- Assisted investment-sale input creates balanced lines from the receiving account, investment account, proceeds, and disposed book value. Account selection and budget selection remain separate.
- Japanese, English, French, Spanish, Simplified Chinese, and Traditional Chinese have complete new copy.
- Existing real journal records are not rewritten automatically.

## RED evidence

`bun test frontend/src/components/MultiLineIncomeBudget.test.tsx`

Executed on dev before implementation: 0 passed, 3 failed. The real compound entry component lacks income allocation controls, principal-return explanation, and assisted investment-sale input. Output: `.tmp/compound-income/red.log` (local, ignored).

## Planned verification

- Targeted calculation and API tests for proceeds/principal/gain, allocation conversion, save/reopen, excluded accounts, rounding, and transfer limits.
- Targeted component tests above.
- Frontend typecheck/build and an isolated headless browser flow, reusing the existing project dev server where practical.
- Independent review of financial state and regression risks.

GREEN and review results will be appended after implementation.
