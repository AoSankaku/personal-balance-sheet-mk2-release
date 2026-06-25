# Development Notes

## `dev`を`main`へマージする

作業ツリーに未コミットの変更がないことを確認してから実行する。

```powershell
git status
git switch main
git pull --ff-only origin main
git merge --no-ff dev -m "Merge dev into main"
git push origin main
```

`main`へのpush後、GitHub Actionsがバージョン更新コミットを追加する。
Actionsの完了後、その変更を`dev`へ同期する。

```powershell
git fetch origin
git switch dev
git merge origin/main
git push origin dev
```

## マージ用Gitエイリアス

このリポジトリでは、次のローカルエイリアスを設定している。

```powershell
git config --local alias.merge-dev "merge --no-ff dev"
```

設定内容の確認：

```powershell
git config --local --get alias.merge-dev
```

エイリアスを使う場合、`main`上で次のように実行する。

```powershell
git switch main
git pull --ff-only origin main
git merge-dev -m "Merge dev into main"
git push origin main
```
