# Kotora transfer description review

The accepted behavior follows the user's final clarification: bank imports retain useful names, warn before saving the original transfer syntax, and offer optional masking of the transfer number. There is no automatic name masking.

## Behavior

- Recognize a Kotora transfer prefix, a name, and a trailing numeric reference in parentheses. Support both bank formats already handled by the app, half-width kana, full-width digits, and both parenthesis widths. This is syntax detection, not a claim about every bank's export format.
- Show the requested Japanese message before any import writes: `ことら送金の名前と送金番号がそのまま含まれています。続行しますか？`.
- Offer unchecked options for masking this time and remembering automatic number masking. Continuing with neither option preserves the original description. Masking changes only the numeric reference to `****`, retaining names and other wording.
- Returning to editing or dismissing the dialog saves neither entries nor a preference. An empty description falls back to the source description and must still be reviewed.
- Remembered masking is a browser-local preference. It applies automatically on later bank imports, shows a preview of the saved description, and can be disabled in Settings > CSV. It does not rewrite existing journals or the source file.
- Review only descriptions entering the current import or salary handoff. Duplicate skips and rows with no selected counter account are excluded from the save confirmation. All existing import paths reach one review gate before API writes.
- CSV store mappings and source rows retain their existing behavior; this feature controls saved journal/handoff descriptions. It does not claim to erase information previously saved in a store mapping or historical entry.

## RED / GREEN evidence

| Guarantee | Evidence |
| --- | --- |
| Explicit opt-in, names preserved, number-only replacement, unchanged unrelated descriptions, empty-note fallback, width variants | `frontend/tests/csvTransferPrivacy.test.ts` initially failed because the new production helper was absent. RED checkpoint: `844a62c`. Seven tests now pass with 39 assertions. |
| Existing CSV mapping, duplicate handoff, and missing-account behavior | Related checks pass: 15 tests across four files, 57 assertions. |
| Original vs. edited vs. one-time masking, no writes on cancel, remembered masking across reload | Headless Chrome with actual Shift-JIS synthetic bank CSVs and an isolated Worker API verified the outgoing batch payload and saved descriptions. |
| Settings reset, duplicate skip/include, missing-account confirmation, salary handoff | Focused headless continuation verified every remaining path, including no silent write for salary handoff. |
| Localization and code health | Frontend TypeScript passes. All 11 new messages exist in all six supported locales. UTF-8 without BOM and `git diff --check` pass. |

Reproduce the command-line checks from the repository root:

```powershell
node node_modules/typescript/bin/tsc --noEmit -p frontend/tsconfig.json
bun test frontend/tests/csvTransferPrivacy.test.ts frontend/tests/csvImportWarnings.test.ts frontend/src/lib/csvStoreMappings.test.ts frontend/src/utils/csvInputUtils.test.ts
bun test --coverage frontend/tests/csvTransferPrivacy.test.ts
```

The new helper has 100% function and line coverage. Coverage of the unchanged CSV parser imported by that helper is not a project-wide coverage claim.

Browser verification used `.tmp/kotoraBrowser.mjs` and `.tmp/kotoraQaServer.ts`. Every application API request was routed to the loopback synthetic API after checking its isolation marker. The first browser run verified the four core flows; the focused continuation verified settings and alternate import paths. The harness needed its Mantine switch selector changed to use the visible label. That was a test-selector correction, not an application defect. Browser processes, Vite, and the synthetic API were stopped after verification.

Independent review found no concrete remaining defects. No production database, Cloudflare deployment, or existing financial records were changed.
