# Personal Balance Sheet MK2

[English](./README.md) | 日本語

> [!CAUTION]
> このプロジェクトは、ほとんどClaude CodeとCodexで実装しました。

## 概要

Personal Balance Sheet MK2は、個人の資産・負債・収支・予算を複式簿記ベースで管理するWebアプリです。

- `frontend/`: Vite + React + TypeScript + Mantine
- `worker/`: Cloudflare Workers + Hono + D1 + Drizzle
- `shared/`: フロントエンドとWorkerで共有するTypeScript型

本番環境では、Cloudflare Workers Static Assetsを使い、フロントエンドと`/api/*`を1つのWorkerから同一オリジンで配信します。Cloudflare Pagesや別の静的ホスティングは使用しません。

## セキュリティ上の注意

このアプリは資産、負債、収入、支出、口座、暗号資産ウォレットなどの機密性が高い情報を扱います。

アプリ自体にはユーザー認証、認可、マルチユーザー分離、レート制限がありません。Cloudflare Zero Trust、VPN、Tailscale、認証付きリバースプロキシなどの外部アクセス制御なしに公開しないでください。

APIにはデータベースのエクスポートや一括削除などの破壊的操作が含まれます。公開SaaSではなく、個人用の非公開管理画面として運用してください。

## 前提環境

- Git
- Bun
- Cloudflareアカウント
- Wrangler CLI
- Webブラウザ
- 任意: SQLiteビューアまたは`sqlite3` CLI

Windowsの非対話シェルでBunが`PATH`にない場合:

```powershell
$env:PATH="$HOME\.bun\bin;$env:PATH"
```

macOS/Linux:

```sh
export PATH="$HOME/.bun/bin:$PATH"
```

依存関係をインストールします。

```sh
bun install
```

## ローカル開発

最初にローカルD1へスキーマを適用します。

```sh
bun run --cwd worker db:migrate
```

通常の開発では、WorkerとViteを別々のターミナルで起動します。

```sh
bun run dev:worker
```

```sh
bun run dev:frontend
```

- フロントエンド: `http://localhost:5173`
- Worker API: `http://localhost:8787`
- Viteは`/api/*`をWorkerへプロキシします
- フロントエンドではHMRを利用できます

### 本番相当のローカル確認

Static Assets、API、ローカルD1を1つのWranglerプロセスで確認する場合:

```sh
bun run dev:fullstack
```

このコマンドはフロントエンドをビルドしてから`http://localhost:8787`で配信します。本番D1には接続せず、`D1_DATABASE_ID`も不要です。一時Wrangler設定は終了時に削除されます。

次の経路を確認できます。

- `/`: Reactアプリ
- `/assets/*`: ビルド済み静的アセット
- `/api/health`: Workerのhealth JSON
- `/api/*`: Worker APIとローカルD1
- `/fs/bs`など: SPAの直接ナビゲーション
- 未定義の`/api/*`: `index.html`ではなくAPIの404

## Cloudflare Workersへのデプロイ

本番Workerは次のルーティングで動作します。

- `/`、`/assets/*`、SPA画面URLはWorkers Static Assetsが配信
- `/api/*`のみWorker scriptを先に実行
- D1 bindingは`env.DB`、binding nameは`DB`
- `assets.run_worker_first = true`は使用しない

デプロイ設定では次のStatic Assets設定を使用します。

```toml
[assets]
directory = "../frontend/dist"
not_found_handling = "single-page-application"
run_worker_first = ["/api/*"]
```

### D1データベースの作成

新しいD1データベースが必要な場合:

```sh
cd worker
bunx wrangler login
bunx wrangler d1 create balance-sheet-db
cd ..
```

出力された`database_id`はリポジトリへ書き込まず、Cloudflare Workers BuildsのBuild Secret `D1_DATABASE_ID`として保存します。これはWorker runtime secretではなく、デプロイ用Wrangler設定を生成するためのビルド時Secretです。

### Cloudflare Workers Builds設定

Git連携したWorkerに次を設定します。

- Root directory: リポジトリルート
- Production branch: 本番ブランチ
- Non-production branch deployments: 無効
- Build Secret: `D1_DATABASE_ID`
- Build command:

  ```sh
  bun install --frozen-lockfile && bun run --cwd frontend build && bun run --cwd worker build
  ```

- Deploy command:

  ```sh
  bun run --cwd worker deploy
  ```

ビルド・デプロイスクリプトは`worker/.wrangler.deploy.toml`を一時生成し、コマンド終了時に削除します。このファイルはGit管理対象外です。

### 本番D1へのマイグレーション

ローカル端末から実行する場合、現在のシェルへD1 IDを設定します。

```powershell
$env:D1_DATABASE_ID="<your-d1-database-id>"
```

macOS/Linux:

```sh
export D1_DATABASE_ID="<your-d1-database-id>"
```

マイグレーションを適用します。

```sh
bun run --cwd worker db:migrate:remote
```

このリポジトリでは、`worker/drizzle/`に保存したWrangler D1 migrationsを使用します。Wranglerは適用済みのマイグレーションファイル名を記録するため、一度適用したファイルは編集しないでください。スキーマ変更は、新しい番号のSQLファイルとして追加します。`db:generate`には依存せず、必要なSQLは手動で管理します。

### D1 Time Travelを使ったバックアップと復元

[D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/)は、D1のproduction storage backendを使用するデータベースで常時有効です。手動で保持するスナップショットを作成する機能ではなく、保持期間内のbookmarkまたは時刻を指定してデータベースを復元します。保持期間はWorkers Paidプランで30日、Workers Freeプランで7日です。

最初に、現在のシェルへ`D1_DATABASE_ID`を設定し、Wranglerで認証してください。データベースの`version`が`production`であることを確認します。

```sh
bun run --cwd worker wrangler:remote -- d1 info balance-sheet-db
```

本番マイグレーションの直前に現在のbookmarkを取得し、表示された値をデプロイ記録などの安全な場所へ保存します。

```sh
bun run --cwd worker wrangler:remote -- d1 time-travel info balance-sheet-db
```

このbookmarkが、アップデート前のデータベース状態を示す復元ポイントになります。bookmarkを利用できるのはTime Travelの保持期間内だけです。それより長期間保存する必要がある場合は、D1 exportも作成して安全に保管してください。

復元する場合は、最初にデプロイを停止し、アプリケーションからの書き込みを止めます。復元はデータベースをその場で上書きし、実行中のクエリとトランザクションをキャンセルする破壊的操作です。保存したbookmarkを指定して復元します。

```sh
bun run --cwd worker wrangler:remote -- d1 time-travel restore balance-sheet-db --bookmark="<saved-bookmark>"
```

または、RFC 3339形式の時刻以前で最も近い状態へ復元できます。

```sh
bun run --cwd worker wrangler:remote -- d1 time-travel restore balance-sheet-db --timestamp="2026-07-27T12:34:56+09:00"
```

対象を確認し、Wranglerのプロンプトで破壊的操作を承認してください。復元後に表示される`previous bookmark`は必ず保存します。保持期間内であれば、その値を指定して復元操作自体を取り消せます。

```sh
bun run --cwd worker wrangler:remote -- d1 time-travel restore balance-sheet-db --bookmark="<previous-bookmark>"
```

復元すると、スキーマと`d1_migrations`テーブルも指定時点の状態へ戻ります。書き込みを再開する前に、復元後のスキーマと互換性があるアプリケーションバージョンをデプロイするか、問題を修正して未適用のマイグレーションを再適用してください。その後、アプリケーションデータと重要な`/api/*`エンドポイントを確認します。

### DBマイグレーションが必要なバージョンへのアップデート

新しいスキーマに依存するWorkerコードをデプロイする前に、本番D1へマイグレーションを適用してください。手動アップデートでは、次の順序を推奨します。

1. 前述の手順で現在のD1 Time Travel bookmarkを記録する。長期保存が必要ならD1 exportも作成する
2. 更新先のバージョンを取得し、ロックファイルどおりに依存関係をインストールする
3. ローカルD1へ未適用のマイグレーションを適用し、フロントエンドをビルドする
4. 前述の手順で`D1_DATABASE_ID`を設定し、Workerのビルド確認後に本番D1へ未適用のマイグレーションを適用する
5. リモートマイグレーションが成功してから、新しいWorkerをデプロイする

```sh
git pull --ff-only
bun install --frozen-lockfile
bun run --cwd worker db:migrate
bun run build:frontend

# これらのコマンドの前に、現在のシェルへD1_DATABASE_IDを設定してください。
bun run build:worker
bun run --cwd worker db:migrate:remote

# リモートマイグレーションの成功後にのみ実行してください。
bun run --cwd worker deploy
```

Wranglerは`d1_migrations`に記録済みのマイグレーションをスキップし、未適用のファイルだけを適用します。リモートマイグレーションに失敗した場合は、新しいWorkerをデプロイせず、マイグレーションエラーを解消するかバックアップを復元してください。

Git連携したCloudflare Workers Buildsを使用する場合は、リモートマイグレーションが成功するまで、新しいリビジョンを本番ブランチへpushまたはmergeしないでください。成功後は手動デプロイコマンドを重ねて実行せず、Workers Buildsによるデプロイを使用します。

通常のバージョンアップに`db:sync:remote`を使用しないでください。このコマンドは本番のアプリケーションデータをローカルD1の内容で置き換えるもので、後述の明示的な同期作業専用です。

### 手動ビルドとデプロイ

```sh
bun run build:frontend
bun run build:worker
bun run --cwd worker deploy
```

デプロイ後に確認します。

- `/`でReactアプリが表示される
- `/api/health`がhealth JSONを返す
- `/api/*`が既存APIとして動く
- `/fs/bs`などへ直接アクセスできる
- 静的アセット要求が不要にWorker scriptをinvokeしない

## ローカルD1データを本番へ同期

次のコマンドは、本番D1のアプリケーションデータをローカルD1の内容で置き換えます。

```sh
bun run --cwd worker db:sync:remote
```

処理内容:

1. `balance-sheet-db`がなければ作成
2. リモートmigrationを適用
3. 同期前バックアップを`.tmp/d1-sync/`へ保存
4. ローカルD1をdata-onlyでUTF-8エクスポート
5. リモートの既存データを依存関係の逆順で削除
6. 外部キー順にテーブル単位でインポート
7. 件数と`PRAGMA foreign_key_check`を検証

```sh
# 確認なしで実行
bun run --cwd worker db:sync:remote -- --yes

# 変更せず実行計画だけ確認
bun run --cwd worker db:sync:remote -- --dry-run

# バックアップを省略（非推奨）
bun run --cwd worker db:sync:remote -- --yes --skip-backup

# データを変更せず件数と外部キーだけ検証
bun run --cwd worker db:sync:remote -- --verify-only
```

## よく使うコマンド

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
