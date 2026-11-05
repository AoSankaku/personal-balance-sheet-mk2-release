# Development Notes

## Runtime versions

このプロジェクトではNode.js `24.18.0`をルートの`.node-version`で指定し、Bun
`1.4.4`をルートの`package.json`の`packageManager`で指定する。ローカル開発と
Cloudflare Buildsではこの指定を使用する。Build Variablesに`NODE_VERSION`や
`BUN_VERSION`を設定している場合は、それぞれ`24.18.0`、`1.4.4`へ揃える。

## 本番デプロイの確認

WranglerのOAuth認証では、Workers Builds APIの専用権限を利用できない場合がある。
ビルド履歴APIが403を返しても、Workerのデプロイ権限や本番の稼働状態とは別に
確認する。現在の本番配信は次のコマンドで確認できる。

```powershell
cd worker
bun run wrangler deployments status --name balance-sheet-worker --json
bun run wrangler versions view <version-id> --name balance-sheet-worker --json
```

本番バージョンのタグ・メッセージと配信割合を照合する。手動デプロイでは
`--keep-vars`で既存の実行時変数を保持し、ソースのコミットを`--tag`、アプリの
バージョンを`--message`に記録する。Build VariablesはWorker実行時の`vars`とは
別の設定であり、`wrangler deploy --var`では変更しない。

## `dev`を`main`へマージする

作業ツリーに未コミットの変更がないことを確認してから実行する。通常は、後述の
プロジェクト限定Gitエイリアスを使用する。

```powershell
git status
git merge-dev
```

`git merge-dev`は、`main`への切り替え、`origin/main`からのfast-forward、`dev`の
マージ、`origin/main`へのpushを順番に実行する。

`main`へのpush後、GitHub Actionsがバージョン更新コミットを追加する。バージョンは
日本時間の年月を基準とし、同じ月なら`beta`番号を増やし、月が変わった場合は
`YYYY.M.0-beta0`から開始する。更新後の`main`は、同じActions内で`dev`へ
fast-forwardされる。

Actionsの完了後、ローカルの`dev`を同期する。

```powershell
git sync-dev
```

Actionsの実行中に`dev`へ別のコミットがpushされていた場合、履歴を上書きしないため
自動同期は失敗する。その場合は、`origin/main`を`dev`へ手動でマージしてからpushする。

## プロジェクト限定Gitエイリアス

このリポジトリでは、次のローカルエイリアスを使用する。設定は`.git/config`だけに
保存されるため、ほかのリポジトリには影響しない。新しくcloneした環境では、次の
コマンドで再設定する。

```powershell
git config --local alias.merge-dev '!git switch main && git pull --ff-only origin main && git merge --no-ff --no-edit dev && git push origin main'
git config --local alias.sync-dev '!git switch dev && git pull --ff-only origin dev'
```

設定内容の確認：

```powershell
git config --local --get-regexp '^alias\.(merge-dev|sync-dev)$'
```

エイリアスを使用しない場合の同等手順：

```powershell
git switch main
git pull --ff-only origin main
git merge --no-ff --no-edit dev
git push origin main

# GitHub Actionsの完了後
git switch dev
git pull --ff-only origin dev
```
