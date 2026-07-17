# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Package Manager

This project uses **bun**. In non-interactive shells, bun may not be on PATH — prefix commands with:
```
export PATH="$HOME/.bun/bin:$PATH" && bun ...
```

## Dev Commands

Run from within each workspace directly — root-level scripts do not work:
```bash
cd frontend && bun run dev     # Vite dev server → http://localhost:5173
cd worker && bun run dev       # Wrangler dev server → http://localhost:8787
cd frontend && bun run build   # tsc + vite build
cd worker && bun run build     # wrangler deploy --dry-run
```

## Database (D1 + Drizzle)

```bash
# Apply migrations locally
cd worker && bun run db:migrate

# Apply to remote (production)
cd worker && bun run db:migrate:remote
```

### Migration system — important quirks

`db:migrate` = `wrangler d1 migrations apply balance-sheet-db --local`
**Wrangler** (not drizzle-kit) applies migrations. D1 records applied migration filenames in `d1_migrations`, so already-applied SQL files are not re-run just because their contents changed.

**Never edit a migration file that may already have been applied to local or remote D1.** Add a new numbered SQL file instead, for example `worker/drizzle/0002_add_example.sql`. This is especially important for remote D1: changing `0000_init.sql` after it has run will not update production.

**Do NOT rely on `db:generate`** — the drizzle-kit snapshot (`worker/drizzle/meta/`) is stale and out of sync with manually-applied migrations. Running `db:generate` opens an interactive prompt and may produce incorrect output. Always write migration SQL files by hand.

**SQLite enums are application-level only** — Drizzle's `text("col", { enum: [...] })` generates a plain `text NOT NULL` column. Adding values to an enum in `schema.ts` requires no migration.

### Current schema

| Table | Key columns | Notes |
| ----- | ----------- | ----- |
| `accounts` | id, name, type, category, currency, include_in_allocatable, created_at | 5 types: asset/liability/equity/income/expense. `include_in_allocatable` controls whether cash/bank accounts count as allocatable budget money |
| `journal_entries` | id, date, description, created_at | Transaction headers |
| `journal_lines` | id, journal_entry_id, account_id, debit, credit, created_at | Must balance per entry |
| `crypto_wallets` | id, account_id (UNIQUE), address, chain, created_at | chain: eth/btc/sol/skr/binance |
| `exchange_credentials` | id, exchange (UNIQUE), api_key, api_secret, created_at | Binance credentials |
| `product_api_credentials` | id, provider (UNIQUE), api_key, api_secret, partner_tag, application_id, updated_at | Product metadata API credentials configured from Settings > General |
| `budget_categories` | id, name, sort_order, rollover_months, budget_group, goal_balance, balance_cap, overflow_budget_category_id, created_at | Virtual budget buckets. All balances roll over in full; caps can overflow to another category |
| `budget_category_accounts` | id, budget_category_id, account_id, ratio | Links expense accounts to categories for spending allocation |
| `budget_category_account_targets` | id, budget_category_id, account_id, ratio | Links budget categories to cash/bank target holding accounts for budget placement guidance |
| `budget_allocations` | id, budget_category_id, year_month, fixed_amount, income_ratio, adhoc_amount, created_at | Monthly per-category allocations |
| `journal_entry_budget_allocations` | id, journal_entry_id, budget_category_id, amount, currency, source | Explicit expense-side budget allocations per journal entry |
| `budget_adjustment_logs` | id, budget_category_id, year_month, amount, currency, date, adjustment_type, note, journal_entry_id, created_at | Manual, reset, income, and transfer budget adjustments |
| `budget_filters` | id, name, is_active, is_used, created_at | Virtual income-distribution pipelines |
| `budget_filter_steps` | id, filter_id, step_order, step_type, created_at | Steps: fixed/capped/remainder |
| `budget_filter_step_allocations` | id, step_id, budget_category_id, amount, ratio, created_at | Per-step category allocations |
| `budget_filter_applications` | id, filter_id, year_month, total_income, created_at | Application log (UNIQUE: filter_id, year_month) |
| `budget_filter_application_allocations` | id, application_id, budget_category_id, amount, created_at | Results of each application |
| `planned_expense_categories` | id, kind, name, estimated_amount, currency, default_expense_account_id, target_date, shopping_plan_type, archived_at, last_checked_out_date, sort_order | User-defined groups for shopping list, wishlist, and scheduled payment items. Shopping lists primarily use category-level estimates, category-level due dates, and category-level default expense accounts. One-off shopping plans archive after completion; routine shopping plans retain budget/date, clear only items, and store the last checkout entry date |
| `planned_expenses` | id, kind, category_id, name, estimated_amount, currency, expense_account_id, target_date, recurrence_type, next_due_date, status, keep_on_routine_clear | Upcoming spending items. `kind` separates shopping list, wishlist, and scheduled payments; `expense_account_id` stores the expense account to use when turning the item into an entry. Shopping-list routine items with `keep_on_routine_clear=true` stay on the list when clearing completed routine shopping |
| `product_metadata_cache` | id, normalized_url, source_site, source_product_id, name, price_amount, availability_status, expires_at | 8-hour cache for product API/OGP metadata used by planned expenses |

Migration files live in `worker/drizzle/` and must be append-only once applied. `0000_init.sql` is the initial baseline; all later schema changes belong in new numbered files such as `0001_*.sql`, `0002_*.sql`, etc. Planned-expense changes that have not been applied remotely are consolidated in `0001_planned_expenses.sql`; once a migration has been applied to remote D1, never edit it and add a new numbered SQL file instead.

### Product metadata API settings

Wishlist product metadata uses official APIs when credentials are configured in Settings > General, and caches product name/price/availability plus OGP metadata in `product_metadata_cache` for 8 hours. Worker secrets/environment variables remain supported as fallback:
- `RAKUTEN_APPLICATION_ID`
- `RAKUTEN_ACCESS_KEY`
- `YAHOO_SHOPPING_APP_ID`
- `AMAZON_ACCESS_KEY`
- `AMAZON_SECRET_KEY`
- `AMAZON_PARTNER_TAG`

Amazon product lookup should use Amazon Associates APIs, not seller-facing SP-API. The legacy Product Advertising API was deprecated on 2026-05-15, so Amazon integration may need migration to the current Associates/Creators API surface.

### Adding a new table — checklist
1. Add the table definition to `worker/src/db/schema.ts`
2. Add a new numbered migration SQL file under `worker/drizzle/` with the `CREATE TABLE` / index statements
3. Export the new inferred types at the bottom of `schema.ts`
4. Add shared TypeScript types to `shared/types.ts`
5. Run `cd worker && bun run db:migrate` to apply locally
6. For production, run `cd worker && bun run db:migrate:remote` before deploying Worker code that depends on the new schema

## Architecture Overview

### Monorepo Structure
- `shared/` — TypeScript types shared between frontend and worker (`@balance-sheet/shared` path alias)
- `frontend/` — Vite + React + TypeScript + Mantine v7 + Recharts
- `worker/` — Hono API on Cloudflare Workers + Drizzle ORM + D1 (SQLite)

### Accounting Model (Double-Entry / 複式簿記)
Account types: `asset | liability | equity | income | expense`. There is **no balance_entries table** — balances are computed at query time via `SUM(debit) - SUM(credit)` over `journal_lines`. Every transaction is a `journal_entries` header + 2+ `journal_lines` rows that must balance (total debits = total credits).

### Budget Model
Budget categories are **virtual buckets** layered on top of physical accounts. Each category links to one or more expense accounts via `budget_category_accounts`; explicit per-entry consumption is stored in `journal_entry_budget_allocations`. Monthly allocations and adjustment logs define how much should flow to each bucket. Budget filters are automated pipelines that distribute income across categories via fixed/capped/remainder steps. All budget balances roll over in full, including negative overruns. Negative budget balances reduce allocatable money rather than increasing it.

Cash/bank accounts can be excluded from budget allocation sources with `accounts.include_in_allocatable=false`. Budget categories can also link to target holding accounts via `budget_category_account_targets`; budget placement groups connected categories/accounts and compares expected budget balances with actual cash balances. Placement guidance is informational and does not move money by itself. Simple transfer input can optionally create `transfer` budget adjustment logs to move budget between categories or consume/disappear it.

Budget reset is represented as a `budget_adjustment_logs` row with `adjustment_type='reset'` that brings a category balance to zero at the reset point. Budget adjustments can carry an optional `note`.

### API Routes (Hono, `worker/src/routes/`)

| Route | File | Methods |
| ----- | ---- | ------- |
| `/api/accounts[?as_of=YYYY-MM-DD]` | `accounts.ts` | GET, POST, PATCH :id, DELETE :id, POST :id/replace |
| `/api/journal` | `journal.ts` | GET, POST, DELETE :id |
| `/api/reports/pl` | `reports.ts` | GET |
| `/api/crypto` | `crypto.ts` | GET, POST, DELETE :id, GET balance, GET resolve |
| `/api/exchange-credentials` | `exchangeCredentials.ts` | GET, POST (upsert), DELETE :id |
| `/api/product-api-credentials` | `productApiCredentials.ts` | GET, POST :provider (upsert), DELETE :provider |
| `/api/planned-expenses` | `plannedExpenses.ts` | GET, POST, PATCH :id, DELETE :id, POST metadata, POST :id/refresh-metadata, GET/POST/PATCH/DELETE categories |
| `/api/budget/categories` | `budget.ts` | GET, POST, PATCH :id, DELETE :id |
| `/api/budget/allocations` | `budget.ts` | POST (upsert), PATCH (delta adhoc/reset/comment) |
| `/api/budget/adjustment-logs` | `budget.ts` | GET, PATCH :id, DELETE :id |
| `/api/budget/summary` | `budget.ts` | GET ?year_month=YYYY-MM[&as_of=YYYY-MM-DD] |
| `/api/budget/filters` | `budget.ts` | GET, POST, PATCH :id, DELETE :id, POST :id/copy, POST :id/apply |

Account deletion safety: `DELETE /api/accounts/:id` returns 409 `{error:'in_use', journal_line_count, crypto_wallet_count}`. `POST /api/accounts/:id/replace` atomically reassigns all journal_lines then deletes via `db.batch()`.

### Frontend Pages & Routes (`frontend/src/`)

| Route | Page | Purpose |
| ----- | ---- | ------- |
| `/` | `OverviewPage.tsx` | Month navigator, budget category cards with progress bars, net worth summary |
| `/input` | `InputPage.tsx` | Entry + import hub. Tabs: シンプル (expense/income/transfer/loan) / 複合仕訳 / 予算調整 / 初期残高入力 / CSVインポート |
| `/fs` | `AssetsPage.tsx` | Asset summary cards (assets/liabilities/equity + income/expenses/net income), DatePickerInput for `?as_of=YYYY-MM-DD` historical view, crypto portfolio |
| `/fs/bs` | `BsPage.tsx` | Read-only balance sheet with optional as-of date |
| `/fs/pl` | `PlPage.tsx` | Read-only P&L with date-range filters |
| `/fs/crypto` | redirect | Legacy route redirected to `/fs/tt` |
| `/fs/tt` | `TtPage.tsx` | Balance reconciliation, including linked crypto wallet actual balances |
| `/fs/report` | `ExportPage.tsx` | Financial report export from the financial-statements hub |
| `/ledger` | `LedgerPage.tsx` | Journal entries with SegmentedControl for simple/double view |
| `/settings` | `SettingsPage.tsx` | Account CRUD, language toggle, budget categories section |
| `/settings/budget` | `BudgetSettingsPage.tsx` | Budget filter step-builder and management |

### Frontend Components (`frontend/src/components/`)

| Component | Purpose |
| --------- | ------- |
| `TopNav.tsx` | Desktop nav header (概要/入力/資産/帳簿/設定) + language/color toggles |
| `BottomNav.tsx` | Mobile-only bottom bar (same 5 routes, icon + label) |
| `AccountTable.tsx` | Accounts list with edit/delete + total row; `onDeleteAccount` is optional (omit → no delete column) |
| `AddAccountModal.tsx` | Create/edit account modal |
| `JournalModal.tsx` | Tabs: simple (household-mode via `SimpleEntryForm`) + multi-line (complex double-entry) |
| `SimpleEntryForm.tsx` | Household-mode form: expense / income / transfer / loan (貸し借り). No initial_balance (moved to InputPage's own tab). Income: 定期収入 Switch + budget filter Select. Loan: direction SegmentedControl + liability account + counter account (asset+expense for borrow; asset only for repay). |
| `JournalTable.tsx` | Journal entries display, `view` prop: `'simple' | 'double'` |
| `BudgetCategoryModal.tsx` | Create/edit budget category (name, group, goals/caps, linked expense accounts, target holding accounts) |
| `BudgetPlacementTable.tsx` | Shared budget placement table with actual/target breakdowns and difference hints |
| `BudgetFilterModal.tsx` | Budget filter step-builder; read-only when `is_used=true` |
| `NetWorthChart.tsx` | Net worth chart component |
| `CryptoWatchModal.tsx` | Add/edit crypto wallet with chain selector (auto/ETH/BTC/SOL/SKR/Binance) |
| `ExchangeCredentialModal.tsx` | Configure Binance API key + secret |

### Account Select UI

When rendering an account in a Mantine `Select` or `MultiSelect`, do not build raw options with `label: account.name` and do not import option rendering from a feature component such as `SimpleEntryForm`.

Use the shared helpers in `frontend/src/lib/accountSelect.tsx`:
- `toAccountOption(account, t)` or `buildAccountOptions(...)` / `buildAccountOptionsByCategory(...)` for option data
- `renderAccountOption` for `renderOption`

These helpers translate system account names and show the account-category icon. If a select uses `toAccountSelectOption(...)` from `accountUtils`, it still needs `renderOption={renderAccountOption as never}` unless the UI intentionally renders plain text outside a select dropdown.

### State Management (`frontend/src/context/AppDataContext.tsx`)

Central context wrapping `BrowserRouter` in `main.tsx`. Provides:

```ts
accounts, journal, pl,
cryptoWallets, exchangeCredentials, cryptoBalances, prices,
budgetCategories, budgetFilters, budgetSummary,
currentYearMonth, setCurrentYearMonth,
loading, error,
refresh(), refreshCryptoBalances(), refreshBudget(), refreshBudgetFilters()
```

- Wallet balances are reconciliation-only actual values; financial statements continue to use journal-computed balances and the shared multi-currency conversion layer.
- `budgetSummary` auto-refreshes when `currentYearMonth` changes

### API Client (`frontend/src/api/client.ts`)

Typed `api.*` methods wrapping `fetch`, proxied through Vite to `localhost:8787` in dev.

```ts
class ApiError extends Error { status: number; body: Record<string, unknown> }

api.accounts.{ list, create, update, delete, replaceAccount }
api.journal.{ list, create, delete }
api.reports.{ pl }
api.crypto.{ list, create, delete, balance }
api.exchangeCredentials.{ list, upsert, delete }
api.budget.{
  listCategories, createCategory, updateCategory, deleteCategory,
  upsertAllocation, patchAdhocAllocation,
  summary, listFilters, createFilter, updateFilter, deleteFilter,
  copyFilter, applyFilter
}
```

### i18n (`frontend/src/i18n/`)

`useLang()` hook returns `{ t, locale, setLocale }`. `LangProvider` wraps the app. Supports `en`, `ja`, `fr`, `es`, `zh-CN`, and `zh-TW`.

When adding or changing user-facing copy, update every supported locale file in `frontend/src/i18n/locales/`, not only English and Japanese. Extra locales should not rely on the English fallback for new UI strings.

### Crypto Balance Reconciliation

- `CryptoChain`: `"eth" | "btc" | "sol" | "skr" | "binance"`
- Treat an account in the `crypto` category as a separately managed investment/speculation holding. Enabling a crypto code as a currency is a different use case for daily payments or currency-separated bookkeeping. The same code (for example BTC) may legitimately appear in both roles and in multiple accounts; reconciliation must keep them distinct by `account_id` and must not merge them by currency code.
- `crypto_wallets`: one row per account (UNIQUE on `account_id`); same address can appear with `chain = "sol"` and `chain = "skr"` to track native SOL and SPL token balance separately
- For `chain = "binance"`, `address` stores the asset ticker (e.g. `BTC`); balance fetched via Binance REST API
- Balance fetched server-side: ETH→cloudflare-eth.com, BTC→blockstream.info, SOL/SKR→Solana RPC (`api.mainnet-beta.solana.com`), Binance→`/api/v3/account` with HMAC-SHA256 signing via `crypto.subtle`
- Wallet links and fetched quantities are managed in `/fs/tt` under actual-balance input. Fetched values do not overwrite balance-sheet or asset-summary ledger balances.
- Domain resolution: `GET /api/crypto/resolve?domain=dasan.skr` — tries AllDomains API for `.skr` TLD, Bonfida SNS for `.sol`
- Binance API credentials stored in `exchange_credentials` table (never in env vars); managed via `ExchangeCredentialModal`
- `hooks/useCryptoPrices.ts` — polls CoinGecko every 60s for JPY prices (BTC/ETH/SOL/SKR/BNB/USDT/USDC); returns `byTicker` map

### PWA

`vite-plugin-pwa@1.2.0` — manifest, icons at `frontend/public/icons/icon-{192,512}.svg`, generates `sw.js` + workbox assets.

### Key Constraints
- All Mantine packages must be **v7** (`@mantine/form` must be `^7.x`, not `^8.x`)
- `postcss-preset-mantine` is required for Mantine CSS variables
- Worker `tsconfig` lacks `skipLibCheck` — `node_modules` type errors are noise; only `src/` errors matter
- Auth is handled externally by Cloudflare Zero Trust — no app-level auth code needed

## File Encoding — Mojibake Prevention

### What happened (2026-04-14)
`TtPage.tsx` was edited by an editor configured for **Shift-JIS (CP932)** on Windows. The editor:
1. Added a UTF-8 BOM (`EF BB BF`) at the start
2. Read existing UTF-8 multi-byte sequences as Shift-JIS pairs and saved the resulting characters back as UTF-8

This corrupted every non-ASCII character in the file. Visually: `¥` became `ﾂ･`, `·` became `ﾂｷ`, box-drawing `─` became `笏\x80` (interleaved U+0080), Japanese strings became unreadable kanji/katakana sequences.

**All `.ts` / `.tsx` files in this repo must be saved as UTF-8 without BOM.**

### Detection
Run this to check for corruption in any file:
```bash
python3 -c "
import sys
with open(sys.argv[1], 'r', encoding='utf-8-sig') as f:
    content = f.read()
bad = [c for c in content if '\uFF61' <= c <= '\uFF9F']
if bad: print('GARBLED half-width katakana found:', bad[:5])
else: print('clean')
" <file>
```

Or check encoding with: `file <path>` — output must say `UTF-8 text`, NOT `UTF-8 (with BOM) text`.

### Recovery
If a file is corrupted, reverse the Shift-JIS double-encoding:
```python
corrupted_string.encode('shift_jis_2004').decode('utf-8')
```
Then open the file with `encoding='utf-8-sig'` (strips BOM) and write back with `encoding='utf-8'`.

Note: some Unicode characters (e.g. `¥` U+00A5, `·` U+00B7, `—` U+2014, `→` U+2192, `←` U+2190, `─` U+2500) produce bytes that are invalid in Shift-JIS, so their corruption is more complex (the third UTF-8 byte becomes U+0080 or is replaced). The box-drawing separator `─` (U+2500, UTF-8: `E2 94 80`) corrupts to `笏\x80` (U+7B0F + U+0080) — replace `笏\x80` × N with `─` × N.

### Editor setting
Configure your editor to always use **UTF-8 without BOM** for `.ts` / `.tsx` files. In VS Code: set `"files.encoding": "utf8"` and `"files.autoGuessEncoding": false` in workspace settings. Do **not** use "Detect" or "Japanese (Shift JIS)" encoding.
