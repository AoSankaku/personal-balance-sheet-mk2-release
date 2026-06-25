# Cloudflare Workers deployment

The production Worker serves both the Vite frontend and the `/api/*` routes.
Cloudflare Static Assets handles `/`, generated assets, and SPA navigation
fallbacks without invoking the Worker script. Only `/api/*` is configured to
run the Worker first.

## Cloudflare Workers Builds

Configure the Git-connected Worker with:

- Root directory: repository root
- Production branch: the repository's production branch
- Build command:

  ```sh
  bun install --frozen-lockfile && bun run --cwd frontend build && bun run --cwd worker build
  ```

- Deploy command:

  ```sh
  bun run --cwd worker deploy
  ```

- Non-production branch deployments: disabled
- Build secret: `D1_DATABASE_ID`, set to the production D1 database UUID

Do not commit the D1 database UUID. The build and deploy scripts generate an
ignored `worker/.wrangler.deploy.toml` for the duration of each command and
delete it afterward.

## Local development

For normal development, run the API and Vite development servers separately:

```sh
bun run dev:worker
bun run dev:frontend
```

Vite serves the frontend at `http://localhost:5173` with HMR and proxies
`/api/*` to the Worker at `http://localhost:8787`.

For a production-like local check, build the frontend and serve the frontend,
API, and local D1 from Wrangler at `http://localhost:8787`:

```sh
bun run dev:fullstack
```

This command uses the local D1 binding. It does not require
`D1_DATABASE_ID` and does not connect to production D1. It generates an
ignored temporary Wrangler configuration and removes it when Wrangler exits.

Verify:

- `/` returns the React application.
- `/api/health` returns the Worker health JSON.
- Direct navigation to a client route such as `/fs/bs` returns the React
  application.
- An unknown `/api/*` route returns an API 404 rather than `index.html`.
