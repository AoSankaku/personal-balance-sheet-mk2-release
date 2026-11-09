# Production release ordering

The incident was an intermediate merge build finishing after its version-update
build and replacing the newer version in production. User intent is to preserve
notifications for any deployed-version change, including intentional downgrades.
The frontend notification predicate is unchanged.

Workers Builds production deployments now require all of the following:

- `WORKERS_CI=1`, branch `main`, a valid commit SHA, and a matching Git checkout.
- The workflow release marker `chore: bump version to <version>` matching the
  checked-out `frontend/src/lib/version.ts`.
- A remote `origin/main` head matching that checkout immediately before invoking
  the deployment command. Verification failures stop deployment.

Intermediate merges and obsolete release retries skip production deployment
before D1 configuration generation. Manual commands, dry-runs, preview uploads,
and D1 operations retain their existing behavior. Git metadata is read without
requiring parent history, so shallow checkouts do not require parent fetching.

| Guarantee | Test |
| --- | --- |
| Intermediate merge builds cannot replace a completed release | `worker/tests/productionDeployGate.test.ts` |
| Only the current workflow release is allowed; stale releases and unverifiable metadata cannot deploy | Same test file |
| Manual/dry-run/preview/D1 commands bypass the production CI gate | Same test file |
| The actual wrapper applies the gate before requiring D1 credentials | Child-process checks in the same test file |
| An intentionally older deployed version still produces a notification | `frontend/tests/reloadPrompt.test.ts` |

The original RED checkpoint was `6c1286d`; the new deployment gate did not exist.
Notification ordering tests from that checkpoint were removed after the user
clarified that downgrade notifications must remain. Notification production code
was restored to its original behavior.

Targeted verification:

```text
bun test frontend/tests/reloadPrompt.test.ts worker/tests/productionDeployGate.test.ts worker/tests/prepareWranglerConfig.test.ts scripts/bump-version-workflow.test.mjs --coverage --coverage-reporter=text
```

The final CI-only run passed 42 tests with 126 assertions. The gate had 100%
function and 95.45% line coverage; subprocess adapter error handling is also
exercised by the wrapper tests, outside the parent-process coverage counters.

This guard addresses the observed merge-versus-version-update ordering issue.
The remote-head check precedes Wrangler's upload; it is not a global mutex across
multiple independent release uploads. Deployment acceptance must include terminal
checks for older intermediate builds and production version verification.
