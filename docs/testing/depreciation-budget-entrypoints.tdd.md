# 減価償却の予算設定への入口とプレビュー速度

ユーザーの追加依頼に基づき、印刷用レポートから編集操作を撤去し、財務諸表の予算画面・貸借対照表・右上のやることリストへ移します。方式の順序と推奨表示を維持し、指示用の丸数字をユーザー向け文言から取り除きます。また、履歴再計算の結果を維持してプレビューの重複DB読み取りを減らします。

## 検証する動作

| 要求 | 検証 |
| --- | --- |
| 予算画面と貸借対照表から同じ修正画面を直接開ける | `worker/tests/depreciationBudget.browser.mjs`、デスクトップ・モバイル幅 |
| 右上の未設定タスクから直接開き、適用後にタスクが消える | 同上、`frontend/src/lib/depreciationBudgetTasks.test.ts` |
| 意図的な未割当・終了済み計画には不要なタスクを出さない | `depreciationBudgetTasks.test.ts` |
| 印刷用レポートに修正ボタンを置かない | 画面テスト |
| 全6言語で説明・警告・同意を含めて丸数字を表示しない | `frontend/tests/depreciationBudgetCopy.test.ts`、画面テスト |
| プライバシーモードで設定操作と計画データ取得を止める | 画面テスト |
| 読取結果はリクエスト内でのみ共有し、呼出元の変更が他の結果を汚さない | `worker/tests/d1ReadMemo.test.ts` |
| プレビューの次のリクエストでは変更後データを取得し、競合を拒否する | `worker/tests/depreciationBudgetPreviewPerformance.test.ts` |
| 長期履歴でもD1の100パラメータ制限を超えず、不正な年月キーを取り込まない | 同上 |
| T/U/各予算・全リセット・同日順序・トークン・適用安全性を保持する | 既存の減価償却API回帰テストと、旧版との全応答比較 |

## RED

`2c51c97 test: reproduce depreciation budget navigation and preview latency` に再現テストを保存しました。

- 変更前の実画面では、`/fs/budget` の「予算負担を設定・修正」が見つからず、画面テストがタイムアウトしました。
- ロケールのテストは、指示用の丸数字を含む6種類の文言を検出して失敗しました。
- 30か月・6リセットの割当済み予算プレビューは431回のSELECTを実行し、70%以上削減するための上限155回を超えました。
- 130か月の履歴では、年月の `IN` 条件が132個のパラメータとなり、D1の100個制限を再現するドライバーで失敗しました。

## 性能改善の方針

プレビューは、購入時・各リセット・現在の修正前後をすべて計算します。同じSQL・パラメータ・読取方法の結果を、1リクエスト内だけで共有します。進行中の読取も共有し、返却値は複製します。revision確認と書込みはキャッシュを使わず、適用時にも新しい読取を行います。

もう一つの改善は、リセットごとの同日イベント検索を、日付・作成日時の一括取得に置き換えることです。同日順序の比較条件自体は変えません。年月の検索には、正規の `YYYY-MM` だけに一致する範囲条件を使います。

比較は実マイグレーションを適用した隔離メモリDBで行います。本番DBへの書込み・実データの修復・追加マイグレーションはありません。探索はメモ化と境界情報の一括取得の2案に限定します。各案は同じ入力を使い、正しさのテストが通るものだけを採用します。

| フィクスチャ | 変更前のDB読取 | リクエスト内共有 | 境界情報の一括取得も適用 |
| --- | ---: | ---: | ---: |
| 特別予算・30か月・6リセット | 515 | 83 | 73 |
| 特別予算・120か月・24リセット | 1,819 | 217 | 171 |

いずれもP=30万円、現金100万円、購入負担予算30万円・月次元10万円の合成データです。DB読取削減率はそれぞれ85.8%・90.6%です。通信待ちを含めた比較には、読取ごとに5msの人工遅延を加えるモデルも使います。この時間は本番環境の実測ではありません。

## GREEN

減価償却API・プレビュー・読取共有の8ファイルは67件・500アサーションが成功しました。

```powershell
bun test worker/tests/depreciationBudget.test.ts worker/tests/depreciationBudgetIntegrity.test.ts worker/tests/depreciationBudgetReset.test.ts worker/tests/depreciationBudgetRepairEdges.test.ts worker/tests/depreciationBudgetPreviewSummary.test.ts worker/tests/depreciationBudgetReadPaths.test.ts worker/tests/depreciationBudgetPreviewPerformance.test.ts worker/tests/d1ReadMemo.test.ts
```

一般の予算集計・財源リセット・リセット履歴・調整履歴の回帰確認は33件・102アサーションが成功しました。

```powershell
bun test worker/tests/budgetSummary.test.ts worker/tests/budgetFundingReset.test.ts worker/tests/budgetResetLogsFilter.test.ts worker/tests/budgetAdjustmentLogs.test.ts
```

フロントエンドの対象7ファイルは28件・6514アサーションが成功しました（`frontend/` で実行）。

```powershell
bun test src/lib/depreciationBudgetTasks.test.ts tests/depreciationBudgetCopy.test.ts tests/i18nTranslations.test.ts tests/taskMenuDesign.test.ts tests/trialBalanceMonthlyTaskFlow.test.ts tests/incomeTransferTasks.test.ts tests/nativeBrowserDialogs.test.ts
```

追加のカバレッジ測定は15件・34アサーションが成功しました。新しい読取共有サービスの行カバレッジは82.93%、タスク選択は100%です。ブラウザで確認した共有プロバイダーや画面全体の行カバレッジを示す値ではありません。

```powershell
bun test worker/tests/depreciationBudgetPreviewPerformance.test.ts worker/tests/d1ReadMemo.test.ts frontend/src/lib/depreciationBudgetTasks.test.ts frontend/src/lib/depreciationBudgetForm.test.ts --coverage
```

`depreciationBudget.browser.mjs` はデスクトップ幅1440px・モバイル幅390pxで予算画面と貸借対照表からモーダルを開き、右上タスクからの直接編集、レポートからのボタン撤去、番号非表示、未割当の同意、リセットの判断、T不変、確認後の適用、補填実績、タスク消去、プライバシー時の読取・操作停止を検証して成功しました。ページのJavaScriptエラーは0件です。

フロントエンドの `bun run build`（TypeScript・Vite・PWA）、Workerの `bun run build`（Wrangler dry-run）も成功しました。Worker全体の単独型チェックには既存の依存型・未変更箇所の診断が残り、今回変更したファイルには新しい診断がありません。

変更前ルート（`2c51c97`）との比較では、割当済み30か月・6リセット、特別予算30か月・6リセット、特別予算120か月・24リセットの全JSON応答が一致しました。トークン・全履歴時点・境界・イベントも比較対象です。応答ハッシュと再現コマンドは [性能測定記録](../../worker/tests/depreciationBudgetPreviewBenchmark.md) に保存しています。

再現用の合成データベンチマークは `worker/tests/helpers/benchmarkDepreciationBudgetPreview.ts` です。最終確認の30か月・6リセット・5ms人工遅延では73回のDB読取、1091.21msでした。変更前の同モデルは515回、約4853msです。これは本番データ・ネットワークの実測ではありません。

今回の確認で実利用DBの変更、追加マイグレーション、デプロイ、pushは行っていません。
