# 収入入力の予算対象判定の統一

## 意図と受入条件

ユーザーとの設計確認から導出した変更。通常の収入入力と支出一括入力の値引き・GC行で、既存の `isBudgetAccount` に基づく同じ予算対象判定を使う。追跡対象の現金資産、または予算控除対象の負債への収入を、選択した予算科目へ配賦できる。収入科目と予算配賦先は引き続き別選択とする。

- 予算対象外の資産・負債には配賦しない。口座変更前や復元済み下書きの配賦を保存時にも除外する。
- 負債減少は現金の入金ではないため、口座間振替の案内・タスクを作らない。追跡対象現金の振替案内は維持する。
- 既存収入を非現金・予算対象外の入金先へ編集した場合、未完了の振替タスクは明示的に解除する。完了済みタスクの変更を拒否する既存APIの保護は維持する。
- 本番データや既存の未配賦収入は変更しない。スキーマ変更・移行・デプロイは不要。

## RED

現在のブランチ `dev` でテストを先に追加し、ローカルチェックポイント `b689c0a` に保存した。

```text
cd frontend
bun test ./src/components/IncomeBudgetScope.test.tsx
5 pass / 3 fail
```

実際のReactコンポーネントを描画するテストで、通常入力の控除対象カードでは配賦欄が表示されず、一括入力の予算対象外口座には対象外の説明が出ないことを再現した。テスト用の静的フィクスチャだけを使用する。

## GREENと実装

`frontend/src/lib/incomeBudgetScope.ts` に共通の判定と送信フィールドの構築をまとめた。通常入力・一括入力の画面判定と保存処理が同じヘルパーを使う。予算対象外の入金先では配賦を除外し、非現金の入金先では `income_transfer_destinations: []` を送信する。

独立レビューで、振替先を単に省略すると、既存収入の更新時に古い未完了タスクが残る問題を検出した。更新APIは `PUT /api/journal/:id` であり、省略は既存タスクの維持、空配列は未完了タスクの解除を表す。送信フィールドを修正し、実際の共通ヘルパーを使うAPI回帰テストで確認した。完了済みタスクの変更は既存の409応答で保護される。再レビューでは追加の具体的な問題はなかった。

| 保証する動作 | 検証 | 結果 |
|---|---|---|
| 通常入力で控除対象カードの配賦欄を表示し、現金の振替案内を出さない | `IncomeBudgetScope.test.tsx` | 成功 |
| 通常入力と一括入力で追跡対象現金・対象カードを許可し、対象外口座を除外する | 同コンポーネントテストと `incomeBudgetScope.test.ts` | 成功 |
| 古い下書きの配賦と振替指定を保存時に除外する | 共通ヘルパー・送信フィールドの単体テスト | 成功 |
| 通常収入でカード負債と選択予算を同額だけ改善し、現金を動かさない | Worker APIテスト | 成功 |
| 一括入力の購入と値引きの差額だけが予算消費になる | Worker APIテスト | 成功 |
| 対象外口座への配賦と、負債減少額を超える配賦をAPIが拒否する | Worker APIテスト | 成功 |
| 現金収入を対象カード・対象外カード・対象外現金へ編集すると未完了タスクが消える | Worker更新APIテスト | 成功 |
| 完了済み振替タスクを伴う編集は409で拒否する | Worker更新APIテスト | 成功 |
| PC幅1440px・モバイル幅390pxで実際に保存でき、口座切替で古い配賦が消える | `worker/tests/incomeBudgetScope.browser.mjs` | 両幅で成功、画面例外0件 |
| 6言語の翻訳キーと値を維持する | `frontend/tests/i18nTranslations.test.ts` | 成功 |

実行した対象テスト：

```text
cd frontend
bun test ./src/components/IncomeBudgetScope.test.tsx ./src/components/SimpleEntryFormBudgetScope.test.ts ./src/lib/incomeBudgetScope.test.ts ./tests/i18nTranslations.test.ts
24 pass / 0 fail / 6,556 assertions

cd worker
bun test ./tests/incomeBudgetScope.test.ts
9 pass / 0 fail

cd frontend
bun test ./src/lib/incomeBudgetScope.test.ts --coverage
7 pass / 0 fail
incomeBudgetScope.ts: functions 100%, lines 100%
```

カバレッジは今回の共通ヘルパーについての値であり、巨大なフォーム全体やアプリ全体のカバレッジを示すものではない。フォームの操作・状態遷移は描画テストとヘッドレスブラウザで補っている。

ブラウザ検証は `worker/tests/helpers/incomeBudgetScopeQaServer.ts` のメモリ内DBのみを使用する。Viteと隔離APIを起動した後、`node worker/tests/incomeBudgetScope.browser.mjs <playwright-package-path>` で実行した。APIの隔離マーカーを確認し、画面からの全APIリクエストをテストAPIへ転送する。本番D1・既存ローカルD1・外部サイトへは接続しない。

## 実行環境と境界

- 一部のBunテストでは終了時にユーザーディレクトリの `EPERM` 診断が出たが、対象テストの成功と終了コード0を確認した。
- 通常のサンドボックス内ではBunのビルド子プロセスが作業ディレクトリを読めず、ヘッドレスブラウザもローカルサーバーへ接続できなかった。ローカルビルドと隔離UI検証を権限付き実行へ切り替えた。ネットワーク設定・ファイアウォール設定は変更していない。
- APIの会計計算・予算原資の計算・返済元設定・本番データは変更していない。新たな実装はフロントエンドの判定・送信処理と説明文に限る。
- 通貨別の金額・明示的な配賦先は既存の入力とサーバー検証を引き継ぐ。今回の画面検証はJPYで実施した。
- 対象を絞った検証を行い、全テストスイートは実行していない。
- 最終ソースで `cd frontend; bun run build` が成功し、TypeScriptとVite/PWAの本番ビルドを確認した。Browserslistデータの既存の更新案内は残る。
- `git diff --check` と、変更・追加した16ファイルのUTF-8/BOM検査が成功した。
- このタスクで起動したVite・隔離API・ヘッドレスブラウザは検証後に停止した。
