# Native browser dialog replacement — TDD evidence

## Red

Command:

```text
bun test frontend/tests/nativeBrowserDialogs.test.ts
```

Before implementation, both checks failed:

- `AGENTS.md` did not prohibit `window.alert`, `window.confirm`, and `window.prompt`.
- The source scan found three `window.confirm` calls: two in `IncomeTransferTasks.tsx` and one in `ProductApiSettingsPage.tsx`.

## Green

Commands:

```text
bun test frontend/tests/nativeBrowserDialogs.test.ts frontend/tests/incomeTransferTasks.test.ts frontend/tests/i18nTranslations.test.ts
bun test frontend/tests frontend/src
bun run build
```

Results:

- Targeted tests: 9 passed, 0 failed.
- Full frontend regression suite: 386 passed, 0 failed.
- Frontend production build: passed.
- Explicit and unqualified native `alert`, `confirm`, and `prompt` calls are rejected by the regression test. Type/interface method signatures such as the PWA installation event's `prompt()` method are intentionally allowed.

## Coverage note

The coverage runner reported module-resolution errors for already-installed `sharp`, `typescript`, and `tslib` dependencies when instrumenting the full suite. The same 386-test suite passes normally, and the TypeScript production build resolves those dependencies successfully.
