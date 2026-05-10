# Binance Integration — 一時無効化

Binance との連携機能は現在使用していないため、このディレクトリに隔離しています。

## 無効化されているファイル

- `ExchangeCredentialModal.tsx` — Binance API キー / シークレットを管理する設定モーダル

## 復元手順

1. `ExchangeCredentialModal.tsx` を `frontend/src/components/` に戻す
2. 使用箇所（例: `CryptoPage.tsx`）で import と表示を再有効化する
3. `CryptoWatchModal.tsx` のチェーン選択肢に `binance` を追加する
4. `hooks/useCryptoPrices.ts` の BNB 価格取得は引き続き動作している
5. `context/AppDataContext.tsx` の binance chain 処理も引き続き動作している

## 残存コード（有効なまま）

以下は削除せず、そのまま残している:
- `api/client.ts` の `exchangeCredentials.*` メソッド群
- `context/AppDataContext.tsx` の `chain === "binance"` 分岐
- `hooks/useCryptoPrices.ts` の BNB 価格
- `shared/types.ts` の `CryptoChain` における `"binance"` 値
