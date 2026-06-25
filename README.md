# Personal Balance Sheet MK2

English | [日本語](./README.ja.md)

> [!CAUTION]
> This project is heavily developed with Claude Code and Codex.

## Overview

Personal Balance Sheet MK2 is a web application for managing personal assets, liabilities, income, expenses, and budgets using double-entry accounting.

- `frontend/`: Vite + React + TypeScript + Mantine
- `worker/`: Cloudflare Workers + Hono + D1 + Drizzle
- `shared/`: TypeScript types shared by the frontend and Worker

In production, Cloudflare Workers Static Assets serves the frontend and `/api/*` from one Worker on the same origin. Cloudflare Pages and separate static hosting are not used.

## Security notice

This application handles highly sensitive financial information, including assets, liabilities, income, expenses, accounts, and crypto wallet details.

The application does not include built-in authentication, authorization, multi-user isolation, or rate limiting. Do not expose it publicly without an external access-control layer such as Cloudflare Zero Trust, a VPN, Tailscale, or an authenticated reverse proxy.

The API includes destructive operations such as database export and bulk deletion. Operate it as a private personal management console, not as a public SaaS service.

## Prerequisites

- Git
- Bun
- Cloudflare account
- Wrangler CLI
- Web browser
- Optional: SQLite viewer or `sqlite3` CLI

If Bun is not on `PATH` in a non-interactive Windows shell:

```powershell
$env:PATH="$HOME\.bun\bin;$env:PATH"
```

On macOS/Linux:

```sh
export PATH="$HOME/.bun/bin:$PATH"
```

Install dependencies:

```sh
bun install
```

## Local development

Apply the schema to local D1 first:

```sh
bun run --cwd worker db:migrate
```

For normal development, start the Worker and Vite in separate terminals:

```sh
bun run dev:worker
```

```sh
bun run dev:frontend
```

- Frontend: `http://localhost:5173`
- Worker API: `http://localhost:8787`
- Vite proxies `/api/*` to the Worker
- Frontend HMR remains available

### Production-like local verification

To serve Static Assets, the API, and local D1 from one Wrangler process:

```sh
bun run dev:fullstack
```

This command builds the frontend and serves everything from `http://localhost:8787`. It uses local D1, does not require `D1_DATABASE_ID`, and does not connect to production D1. The temporary Wrangler configuration is removed when the process exits.

Verify these routes:

- `/`: React application
- `/assets/*`: built static assets
- `/api/health`: Worker health JSON
- `/api/*`: Worker API and local D1
- Client routes such as `/fs/bs`: direct SPA navigation
- Unknown `/api/*` routes: API 404 rather than `index.html`

## Deploying to Cloudflare Workers

The production Worker uses this routing model:

- Workers Static Assets serves `/`, `/assets/*`, and SPA routes
- Only `/api/*` runs the Worker script first
- The D1 binding remains `env.DB` with binding name `DB`
- `assets.run_worker_first = true` is not used

The deployment configuration uses:

```toml
[assets]
directory = "../frontend/dist"
not_found_handling = "single-page-application"
run_worker_first = ["/api/*"]
```

### Create the D1 database

If a new D1 database is required:

```sh
cd worker
bunx wrangler login
bunx wrangler d1 create balance-sheet-db
cd ..
```

Do not commit the resulting `database_id`. Store it as the Cloudflare Workers Builds secret `D1_DATABASE_ID`. This is a build-time secret used to generate the deployment Wrangler configuration, not a Worker runtime secret.

### Cloudflare Workers Builds configuration

Configure the Git-connected Worker with:

- Root directory: repository root
- Production branch: the repository's production branch
- Non-production branch deployments: disabled
- Build secret: `D1_DATABASE_ID`
- Build command:

  ```sh
  bun install --frozen-lockfile && bun run --cwd frontend build && bun run --cwd worker build
  ```

- Deploy command:

  ```sh
  bun run --cwd worker deploy
  ```

The build and deploy scripts create `worker/.wrangler.deploy.toml` temporarily and delete it when the command exits. The generated file is ignored by Git.

### Apply migrations to production D1

For remote operations from a local terminal, set the D1 ID in the current shell.

Windows PowerShell:

```powershell
$env:D1_DATABASE_ID="<your-d1-database-id>"
```

macOS/Linux:

```sh
export D1_DATABASE_ID="<your-d1-database-id>"
```

Apply migrations:

```sh
bun run --cwd worker db:migrate:remote
```

This repository uses Wrangler D1 migrations. `worker/drizzle/0000_init.sql` is the canonical schema file. Do not rely on `db:generate`; update required SQL manually.

### Manual build and deployment

```sh
bun run build:frontend
bun run build:worker
bun run --cwd worker deploy
```

After deployment, verify:

- `/` displays the React application
- `/api/health` returns the health JSON
- Existing `/api/*` endpoints work
- Direct navigation to routes such as `/fs/bs` works
- Static asset requests do not unnecessarily invoke the Worker script

## Synchronizing local D1 data to production

The following command replaces the production D1 application data with the contents of local D1:

```sh
bun run --cwd worker db:sync:remote
```

The command:

1. Creates `balance-sheet-db` if it does not exist
2. Applies remote migrations
3. Saves a pre-sync backup under `.tmp/d1-sync/`
4. Exports local D1 data only, preserving UTF-8
5. Deletes existing remote data in reverse dependency order
6. Imports one table at a time in foreign-key order
7. Verifies table counts and runs `PRAGMA foreign_key_check`

```sh
# Run without an interactive confirmation
bun run --cwd worker db:sync:remote -- --yes

# Show the plan without changing remote data
bun run --cwd worker db:sync:remote -- --dry-run

# Skip the remote backup (not recommended)
bun run --cwd worker db:sync:remote -- --yes --skip-backup

# Verify counts and foreign keys without changing data
bun run --cwd worker db:sync:remote -- --verify-only
```

## Common commands

```sh
bun run dev:frontend
bun run dev:worker
bun run dev:fullstack
bun run build:frontend
bun run build:worker
bun run --cwd worker db:migrate
bun run --cwd worker db:migrate:remote
bun run --cwd worker db:sync:remote
bun run --cwd worker deploy
```
