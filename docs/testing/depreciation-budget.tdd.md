# 減価償却の予算負担方式・検証記録

対象: `codex_depreciation_budget_implementation.md` に基づく実装。実利用 DB の移行・修復・デプロイは実施していません。

## 要求と検証の対応

| 要求 | 主な検証 |
| --- | --- |
| ②→①→③の順序、必要項目、③の明示同意、②の不足警告 | `frontend/src/lib/depreciationBudgetForm.test.ts`、ヘッドレス画面テスト |
| 30万円購入・毎月1万円の T/U/B の具体値、負残高、会計との分離 | `worker/tests/depreciationBudgetIntegrity.test.ts` |
| 既存計画の未設定・旧購入配賦・旧月次配賦・予約の置換 | `depreciationBudget.test.ts`、`depreciationBudgetRepairEdges.test.ts` |
| 全リセットの再評価、直前残高からの転記額再計算、同日順序、旧全体リセットの範囲確認 | `depreciationBudgetRepairEdges.test.ts`、`depreciationBudgetPreviewSummary.test.ts` |
| 3回補填後の残額保持、継続／終了、特別予算引継ぎ／精算 | `depreciationBudgetReset.test.ts`、`depreciationBudgetIntegrity.test.ts` |
| 残存額・一部／一括補填・将来予定・中止された月の区別 | `depreciationBudget.test.ts`、`depreciationBudgetIntegrity.test.ts` |
| 非追跡／混合財源・小数通貨・事業立替を含む複合購入 | `depreciationBudget.test.ts`、`depreciationBudgetRepairEdges.test.ts` |
| 方式変更・適用日付き移行・無関係な手動資金保持・購入訂正／取消 | `depreciationBudget.test.ts`、`depreciationBudgetIntegrity.test.ts` |
| 競合・再送・同時適用・途中失敗のロールバック・片側操作保護 | 上記 API テストと `depreciationBudgetReset.test.ts` |
| 480か月の作成／再構築／取消、長期計画の一覧・レポート、D1のパラメータ制限 | `depreciationBudget.test.ts`、`depreciationBudgetReadPaths.test.ts` |
| 全6言語の翻訳・ネイティブダイアログ禁止・既存予算／仕訳の非回帰 | 下記の関連回帰テスト |

## RED の証拠

現在の作業ブランチに次のテストチェックポイントを保存しました。最初から実装済みとして扱ったり、失敗する検証を削除・スキップしたりしていません。

- `1213453 test: reproduce depreciation budget reset and form requirements`
- `3a00b54 test: reproduce explicit depreciation budget repair requirements`
- `3f6b09e test: protect configured depreciation from journal deletion`

実装後の追加検証でも、精算後の再プレビュー差分、リセット精算時の採番衝突、旧配賦の識別、プレビューの時点不一致、生成仕訳の汎用削除競合などを再現して修正しました。最終レビューでは480か月計画の取消が480パラメータになることをテストで確認し、サブクエリ削除へ変更しました。明示的な全消去後に新設の監査データが残る問題も、失敗テストを確認して修正しています。

## GREEN の検証

`bun test` をリポジトリ直下で実行します。各テストは実マイグレーションを適用したインメモリ SQLite を使用します。

```powershell
bun test worker/tests/depreciationBudget.test.ts worker/tests/depreciationBudgetIntegrity.test.ts worker/tests/depreciationBudgetReset.test.ts worker/tests/depreciationBudgetRepairEdges.test.ts worker/tests/depreciationBudgetPreviewSummary.test.ts worker/tests/depreciationBudgetReadPaths.test.ts --coverage
```

関連する既存機能の回帰確認:

```powershell
bun test worker/tests/budgetAdjustmentLogs.test.ts worker/tests/budgetResetLogsFilter.test.ts worker/tests/budgetCategoryArchive.test.ts worker/tests/budgetSummary.test.ts worker/tests/accountingIntegrity.test.ts worker/tests/journalBudgetAllocationLimits.test.ts worker/tests/budgetFundingReset.test.ts worker/tests/dbHardening.test.ts frontend/src/lib/depreciationBudgetForm.test.ts frontend/tests/i18nTranslations.test.ts frontend/tests/nativeBrowserDialogs.test.ts frontend/tests/budgetFundingAllocation.test.ts frontend/tests/allocatableBudget.test.ts
```

減価償却関連は59件・478アサーション、上記の関連回帰確認は100件・6613アサーションが成功しました。新サービスの行カバレッジは98.02%、リセットサービスは99.19%、既存分岐を含む減価償却ルート全体は82.58%です。カバレッジの対象には既存の巨大な汎用ルートも読み込まれるため、全体値と変更部分の値を区別します。全ファイル80%達成とは主張しません。

画面テストは `worker/tests/depreciationBudget.browser.mjs` です。隔離 API (`worker/tests/helpers/depreciationBudgetQaServer.ts`) と Vite を使い、Playwright の Chromium をヘッドレスで実行します。方式順序、③の警告・同意、未設定計画の修正、リセット境界の選択、各時点の T 不変、確認後の適用、補填済み4万円／残額26万円を検証します。API は毎回新しいメモリ DB で起動します。

フロントエンドの `bun run build`（TypeScript・Vite・PWA）と Worker の `bun run build`（Wrangler dry-run）は成功しました。Worker全体の単独TypeScriptチェックには既存の依存型・未変更箇所のエラーが残ります。変更した減価償却ルート・サービスの診断はありません。

## 検証範囲の限界

- 本番 Cloudflare D1 上の実行、実利用データの修復、全体リグレッション、全端末／全ブラウザの画面確認は未実施です。
- 隔離 SQLite は D1 そのものではありません。長期計画ではパラメータ数と一括処理件数を別途検証します。
- 購入訂正は専用の減価償却編集、取消は専用の削除経路を検証します。任意の外部返金仕訳を減価償却計画へ自動的に関連付けて補填実績を減らす機能は追加していません。返金を受けた計画の変更は明示的な訂正が必要です。
- 古い配賦の出所やリセット範囲・同日順序を特定できない場合は推測で修復しません。画面での明示選択、または対応不明データの確認が必要です。
- 既存の科目統合機能はありません。適用日付きで将来の振替先を変更してからアーカイブする操作を提供します。

導入と操作手順は [減価償却と予算負担](../depreciation-budget-methods.md) を参照してください。
