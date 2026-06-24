# Personal Balance Sheet MK2

> [!CAUTION]
> このプロジェクトは、ほとんどClaude CodeとCodexで実装しました。

> [!CAUTION]
> This project is HEAVILY developed with Claude Code and Codex.

## 日本語

### 概要

Personal Balance Sheet MK2 は、個人の資産・負債・収支・予算を複式簿記ベースで管理する Web アプリです。

- `frontend/`: Vite + React + TypeScript + Mantine
- `worker/`: Cloudflare Workers + Hono + D1 + Drizzle
- `shared/`: フロントエンドと Worker で共有する TypeScript 型

フロントエンドは `/api` に対して通信します。本番では、フロントエンドと API を同じ公開オリジンに置き、`/api/*` を Worker に転送する構成を推奨します。

### セキュリティ上の注意

このアプリは個人利用・セルフホストを前提としており、資産、負債、収支、口座、暗号資産ウォレットなどの機微な金融情報を扱います。

アプリ本体には、ユーザー認証、権限管理、マルチユーザー分離、レート制限は組み込まれていません。Cloudflare Zero Trust、VPN、Tailscale、認証付きリバースプロキシなどの外部アクセス制御なしに、フロントエンドや Worker/API をインターネットへ直接公開しないでください。

API にはデータベースのエクスポートや一括削除など、機微かつ破壊的な操作が含まれます。このアプリは公開 SaaS ではなく、私的な管理画面として扱ってください。

このプロジェクトは頻繁な保守更新を前提にしていません。セルフホストする利用者は、依存関係の更新、アクセス制御、バックアップ、デプロイ環境の保護を自分で管理する必要があります。

### 前提アプリ

開発とデプロイには次を用意してください。

- Git
- Bun
- Cloudflare アカウント
- Wrangler CLI
- Web ブラウザ
- 任意: Nginx / Caddy / Cloudflare Pages などの静的ファイル配信環境
- 任意: SQLite ビューアまたは `sqlite3` CLI

このリポジトリは Bun を使います。Windows の非対話シェルで Bun が見つからない場合は、コマンドの前に次を実行します。

```powershell
$env:PATH="$HOME\.bun\bin;$env:PATH"
```

macOS/Linux では次を使います。

```bash
export PATH="$HOME/.bun/bin:$PATH"
```

### 開発環境サーバーで試す

1. 依存関係をインストールします。

```powershell
bun install
```

2. ローカル D1 にスキーマを適用します。

```powershell
cd worker
bun run db:migrate
```

3. Worker を起動します。

```powershell
cd worker
bun run dev
```

Worker は通常 `http://localhost:8787` で起動します。

4. 別ターミナルでフロントエンドを起動します。

```powershell
cd frontend
bun run dev
```

フロントエンドは `http://localhost:5173` で起動します。Vite の開発サーバーは `/api` を `http://localhost:8787` にプロキシします。

初回表示時にデータベースが空の場合、アプリは最低限の初期科目を投入します。

### 本番セルフホスト構成（推奨）

推奨の基本構成は次です。

- API とデータベース: Cloudflare Workers + D1
- フロントエンド: `frontend/dist` を静的配信
- ルーティング: 同じ公開ドメインで `/api/*` を Worker に転送し、それ以外をフロントエンドに配信

このアプリのフロントエンドは API のベース URL を `/api` として固定しています。別ドメインの API に直接接続する構成より、同一オリジンで `/api` をプロキシする構成がシンプルです。

#### 1. D1 データベースを用意する

新しい Cloudflare D1 データベースを作る場合:

```powershell
cd worker
bunx wrangler login
bunx wrangler d1 create balance-sheet-db
```

出力された `database_id` は、Cloudflare ダッシュボードの Worker にビルド用 Secret として保存します。

1. `Workers & Pages > 対象 Worker > Settings > Build` を開きます。
2. `Build variables and secrets` に Secret `D1_DATABASE_ID` を追加し、値に D1 の `database_id` を設定します。
3. Git 連携ビルドでは Root directory を `worker`、Build command を `bun run build`、Deploy command を `bun run deploy`、Non-production branch deploy command を `bun run deploy:preview` に設定します。

`D1_DATABASE_ID` は Worker の実行時 Secret ではなく、Wrangler 設定を生成するためのビルド用 Secret です。リポジトリ内の `worker/wrangler.toml` を編集する必要はありません。ビルド、リモートマイグレーション、デプロイ時だけ `worker/.wrangler.deploy.toml` を生成し、コマンド終了後に削除します。このファイルは `.gitignore` の対象です。

ローカル端末からリモート操作を行う場合は、同じ値を現在のシェルに設定します。

```powershell
$env:D1_DATABASE_ID="<your-d1-database-id>"
```

macOS/Linux:

```bash
export D1_DATABASE_ID="<your-d1-database-id>"
```

#### 2. 本番 D1 にマイグレーションを適用する

```powershell
cd worker
bun run db:migrate:remote
```

このリポジトリでは Wrangler D1 migrations を使います。`worker/drizzle/0000_init.sql` が正のスキーマ定義です。`db:generate` は使わず、必要な SQL は手で更新してください。

#### 3. Worker をデプロイする

```powershell
cd worker
bun run deploy
```

デプロイ後、`https://<worker-name>.<account>.workers.dev/` が `{"status":"ok"}` を返すことを確認します。

#### 4. フロントエンドをビルドする

```powershell
cd frontend
bun run build
```

生成物は `frontend/dist` に出力されます。このディレクトリを任意の静的ホスティングに配置します。

#### 5. `/api/*` を Worker に転送する

本番では、公開 URL の `/api/*` が Worker に到達する必要があります。方法はどれか 1 つで十分です。

- Cloudflare の同一ドメイン上で `/api/*` を Worker Route に割り当てる
- Cloudflare Pages Functions / Pages の設定で `/api/*` を Worker に接続する
- 自前の Nginx / Caddy で `/api/*` を Worker にリバースプロキシする

Nginx の最小例:

```nginx
server {
  listen 443 ssl;
  server_name example.com;

  root /var/www/personal-balance-sheet;
  index index.html;

  location /api/ {
    proxy_pass https://balance-sheet-worker.<account>.workers.dev;
    proxy_ssl_server_name on;
    proxy_set_header Host balance-sheet-worker.<account>.workers.dev;
  }

  location / {
    try_files $uri $uri/ /index.html;
  }
}
```

異なるオリジンから Worker を直接呼ぶ場合は、`worker/src/index.ts` の CORS 許可オリジンに本番フロントエンドの URL を追加してください。同一オリジンで `/api` を転送する構成なら通常は不要です。

### 開発環境で入れたテストデータを本番 D1 に引き継ぐ

次の1コマンドで、ローカル D1 の全アプリデータをリモート D1 へ同期できます。

```powershell
cd worker
bun run db:sync:remote
```

この処理はリモート D1 のアプリデータを置き換えます。確認プロンプトで `yes` と入力すると、次を順番に実行します。

1. `balance-sheet-db` が未作成なら作成
2. リモート migration を適用
3. 同期前のリモートバックアップを `.tmp/d1-sync/` に保存
4. ローカル D1 を data-only で UTF-8 エクスポート
5. リモートの既存アプリデータを外部キーの逆順で削除
6. テーブル単位・外部キー順でインポート
7. ローカル/リモートの全テーブル件数と外部キー整合性を検証

認証には `wrangler login`、または `CLOUDFLARE_API_TOKEN` を使用します。D1 ID は `wrangler d1 list` から取得するため、この同期コマンドではコードや設定ファイルへの ID の直書きは不要です。

```powershell
# 確認なしで実行
bun run db:sync:remote -- --yes

# 変更せず実行計画だけ確認
bun run db:sync:remote -- --dry-run

# バックアップを省略（非推奨）
bun run db:sync:remote -- --yes --skip-backup

# データを変更せず件数と外部キーだけ検証
bun run db:sync:remote -- --verify-only
```

バックアップ、ローカルエクスポート、テーブル別SQLは `.tmp/d1-sync/` に保存され、Git管理対象外です。途中で migration、バックアップ、削除、インポート、検証のいずれかが失敗した場合は exit code 1 で停止し、インポート失敗時は対象テーブル名を表示します。

### よく使うコマンド

```powershell
# Frontend dev server
cd frontend
bun run dev

# Worker dev server
cd worker
bun run dev

# Frontend build
cd frontend
bun run build

# Worker dry-run build
cd worker
bun run build

# Apply local D1 migrations
cd worker
bun run db:migrate

# Apply remote D1 migrations
cd worker
bun run db:migrate:remote

# Sync local D1 data to remote D1
cd worker
bun run db:sync:remote

# Deploy Worker
cd worker
bun run deploy
```

## English

### Overview

Personal Balance Sheet MK2 is a web app for managing personal assets, liabilities, income, expenses, and budgets using double-entry accounting.

- `frontend/`: Vite + React + TypeScript + Mantine
- `worker/`: Cloudflare Workers + Hono + D1 + Drizzle
- `shared/`: TypeScript types shared by the frontend and Worker

The frontend calls the API through `/api`. In production, the recommended setup is to serve the frontend and API from the same public origin and route `/api/*` to the Worker.

### Security Notice

This application is designed for personal self-hosting and stores highly sensitive financial data, including assets, liabilities, income, expenses, accounts, and crypto wallet information.

The application does not include built-in user authentication, authorization, multi-user isolation, or rate limiting. Do not expose the frontend or Worker/API directly to the public internet unless it is protected by an external access-control layer such as Cloudflare Zero Trust, a VPN, Tailscale, or an authenticated reverse proxy.

The API includes sensitive and destructive operations, including database export and bulk data deletion. Treat this application as a private management console, not as a public SaaS service.

This project is not designed around frequent maintenance updates. Self-hosters are responsible for dependency updates, access control, backups, and deployment security.

### Prerequisites

Install or prepare the following:

- Git
- Bun
- Cloudflare account
- Wrangler CLI
- Web browser
- Optional: Nginx / Caddy / Cloudflare Pages or another static hosting target
- Optional: SQLite viewer or `sqlite3` CLI

This repository uses Bun. If Bun is not on `PATH` in a non-interactive Windows shell, run:

```powershell
$env:PATH="$HOME\.bun\bin;$env:PATH"
```

On macOS/Linux:

```bash
export PATH="$HOME/.bun/bin:$PATH"
```

### Try It With Development Servers

1. Install dependencies.

```powershell
bun install
```

2. Apply the schema to the local D1 database.

```powershell
cd worker
bun run db:migrate
```

3. Start the Worker.

```powershell
cd worker
bun run dev
```

The Worker normally runs at `http://localhost:8787`.

4. Start the frontend in another terminal.

```powershell
cd frontend
bun run dev
```

The frontend runs at `http://localhost:5173`. The Vite dev server proxies `/api` to `http://localhost:8787`.

On first load, if the database is empty, the app inserts a minimal set of starter accounts.

### Recommended Self-Hosted Production Setup

The recommended baseline production setup is:

- API and database: Cloudflare Workers + D1
- Frontend: static hosting for `frontend/dist`
- Routing: serve everything from one public domain, proxy `/api/*` to the Worker, and serve the frontend for all other paths

The frontend currently uses `/api` as its fixed API base. Keeping the API behind the same origin is simpler than calling a separate API domain directly.

#### 1. Create a D1 Database

If you need a new Cloudflare D1 database:

```powershell
cd worker
bunx wrangler login
bunx wrangler d1 create balance-sheet-db
```

Store the generated `database_id` as a build secret on the Worker in the Cloudflare dashboard.

1. Open `Workers & Pages > your Worker > Settings > Build`.
2. Under `Build variables and secrets`, add a secret named `D1_DATABASE_ID` and use the D1 `database_id` as its value.
3. For Git-integrated builds, set Root directory to `worker`, Build command to `bun run build`, Deploy command to `bun run deploy`, and Non-production branch deploy command to `bun run deploy:preview`.

`D1_DATABASE_ID` is a build secret used to generate Wrangler configuration, not a Worker runtime secret. You do not need to edit `worker/wrangler.toml`. Builds, remote migrations, and deployments create `worker/.wrangler.deploy.toml` only for the duration of the command and remove it afterward. The file is covered by `.gitignore`.

For remote operations from a local terminal, set the same value in the current shell:

```powershell
$env:D1_DATABASE_ID="<your-d1-database-id>"
```

macOS/Linux:

```bash
export D1_DATABASE_ID="<your-d1-database-id>"
```

#### 2. Apply Migrations to Remote D1

```powershell
cd worker
bun run db:migrate:remote
```

This repo uses Wrangler D1 migrations. `worker/drizzle/0000_init.sql` is the canonical schema file. Do not rely on `db:generate`; write required migration SQL manually.

#### 3. Deploy the Worker

```powershell
cd worker
bun run deploy
```

After deployment, confirm that `https://<worker-name>.<account>.workers.dev/` returns `{"status":"ok"}`.

#### 4. Build the Frontend

```powershell
cd frontend
bun run build
```

The output is written to `frontend/dist`. Serve that directory from your static hosting target.

#### 5. Route `/api/*` to the Worker

In production, requests to `/api/*` on the public site must reach the Worker. Use one of these approaches:

- Attach a Cloudflare Worker Route for `/api/*` on the same domain
- Connect `/api/*` to the Worker from Cloudflare Pages / Pages Functions
- Reverse proxy `/api/*` to the Worker from Nginx / Caddy

Minimal Nginx example:

```nginx
server {
  listen 443 ssl;
  server_name example.com;

  root /var/www/personal-balance-sheet;
  index index.html;

  location /api/ {
    proxy_pass https://balance-sheet-worker.<account>.workers.dev;
    proxy_ssl_server_name on;
    proxy_set_header Host balance-sheet-worker.<account>.workers.dev;
  }

  location / {
    try_files $uri $uri/ /index.html;
  }
}
```

If you call the Worker directly from a different origin, add the production frontend URL to the CORS allowlist in `worker/src/index.ts`. With the same-origin `/api` proxy setup, that is usually unnecessary.

### Carry Local Test Data Into Production D1

Use one command to synchronize all application data from local D1 to remote D1:

```powershell
cd worker
bun run db:sync:remote
```

This replaces the remote D1 application data. After you type `yes` at the confirmation prompt, the command:

1. Creates `balance-sheet-db` if it does not exist
2. Applies remote migrations
3. Saves a pre-sync remote backup under `.tmp/d1-sync/`
4. Exports local D1 data only, preserving UTF-8
5. Deletes existing remote application data in reverse dependency order
6. Imports one table at a time in foreign-key order
7. Verifies every table count and runs `PRAGMA foreign_key_check`

Authenticate with `wrangler login` or `CLOUDFLARE_API_TOKEN`. The command resolves the D1 ID through `wrangler d1 list`, so no database ID needs to be hardcoded in source or configuration.

```powershell
# Run without an interactive confirmation
bun run db:sync:remote -- --yes

# Show the plan without changing remote data
bun run db:sync:remote -- --dry-run

# Skip the remote backup (not recommended)
bun run db:sync:remote -- --yes --skip-backup

# Verify counts and foreign keys without changing data
bun run db:sync:remote -- --verify-only
```

Backups, local exports, and per-table import files are retained under `.tmp/d1-sync/` and ignored by Git. Migration, backup, deletion, import, or verification failures stop with exit code 1. Import errors identify the table that failed.

### Common Commands

```powershell
# Frontend dev server
cd frontend
bun run dev

# Worker dev server
cd worker
bun run dev

# Frontend build
cd frontend
bun run build

# Worker dry-run build
cd worker
bun run build

# Apply local D1 migrations
cd worker
bun run db:migrate

# Apply remote D1 migrations
cd worker
bun run db:migrate:remote

# Sync local D1 data to remote D1
cd worker
bun run db:sync:remote

# Deploy Worker
cd worker
bun run deploy
```
