---
id: crypto
titleJa: 暗号資産ウォッチ
titleEn: Crypto Asset Watch
---

# Crypto Asset Watch

Crypto Asset Watch links wallet addresses to crypto asset accounts so you can check balances and JPY-equivalent values. Manage it from Financial Statements -> Crypto.

In addition to balances calculated from normal journal entries, the app can fetch actual on-chain balances and reflect them in the crypto asset valuation shown in financial statements.

## Main Supported Types

| Type | Content |
| --- | --- |
| BTC | Balance of a Bitcoin address |
| ETH | Balance of an Ethereum address |
| SOL | SOL balance of a Solana wallet |
| SKR | SKR balance on a Solana-family address |
| mSOL | SOL-equivalent balance staked through Marinade |
| SOL Stake | Balance of a Solana native stake account |

Binance integration is currently disabled. If you want to manage exchange balances, create crypto asset accounts and manage them with manual journal entries or actual balance checks as needed.

## Adding A Wallet

1. In Settings, create an asset account in the crypto category.
2. Open Financial Statements -> Crypto.
3. Add a wallet, then choose the chain, address, and linked account.
4. Use balance fetch to check the available quantity and JPY-equivalent amount.
5. Save it to show the wallet in the crypto asset list.

In general, one account is linked to one wallet setting. Even with the same Solana address, you may want to treat SOL, SKR, mSOL, and similar assets separately, so create separate accounts when needed.

## How JPY Values Are Handled

On the Crypto page, the app multiplies fetched quantities by price data to show JPY-equivalent values. Prices are fetched from external price sources and can be refreshed on the screen.

For accounts in the crypto category, the valuation shown in financial statements may be overwritten by the value calculated from fetched quantity and price, instead of the balance calculated only from journal entries. This lets you view total assets closer to current market value.

## Relationship With Journal Entries

Crypto Asset Watch is for checking holding quantity and valuation. It does not automatically journal every purchase, sale, swap, transfer, fee, realized gain, or realized loss.

When you buy crypto assets, you still need a journal entry that decreases the payment asset and increases the crypto asset account. When you sell, record the increase in cash/deposits, decrease in crypto assets, and gain or loss if needed.

## Notes For Solana-Family Assets

SOL, SKR, mSOL, and SOL Stake can use similar address formats. Automatic detection may not distinguish them correctly, so explicitly choose the chain when needed.

Marinade mSOL and native stake accounts use different balance-fetching methods from normal wallet balances. If balance fetch fails, check whether the address type is correct and whether the target is a wallet address or a stake account address.

## Managing Stocks and Securities

Stocks, mutual funds, and similar securities are managed by creating an account in the investment category of assets. The balance is calculated from journal entries.

### Purchase Journal Entry

Use a multi-line entry when buying stocks.

| Debit | Credit |
| --- | --- |
| Investment account (shares held) | Payment account (cash/deposits) |
| Purchase fee (expense, if applicable) | |

Noting the purchase price or cost basis in the description field will help with profit/loss calculation later.

### Sale Journal Entry

A sale generates a realized gain if the sale price exceeds the cost basis, or a realized loss if it is below.

**Sale with a gain:**

| Debit | Credit |
| --- | --- |
| Receiving account (cash/deposits) | Investment account (shares held) |
| | Securities sale gain |

**Sale with a loss:**

| Debit | Credit |
| --- | --- |
| Receiving account (cash/deposits) | Investment account (shares held) |
| Securities sale loss | |

"Securities sale gain" and "Securities sale loss" are available as system accounts.

## Recording Crypto Asset Trades

Crypto asset sales follow the same logic as securities.

| Type | System account to use |
| --- | --- |
| Sale gain | Crypto asset sale gain |
| Sale loss | Crypto asset sale loss |

Crypto Asset Watch is for checking holdings and valuations. It does not automatically journal purchases, sales, swaps, or transfers. Record actual trades separately as multi-line journal entries.

### Difference Between Valuation and Book Value

When Crypto Asset Watch is active, financial statements show valuations at current market prices. The ledger balance, however, is based on the recorded amounts at acquisition. The gap between these is an unrealized gain or loss and is not reflected in the ledger until you sell.

For stocks, there is also no automatic monthly revaluation. The cost basis stays in the ledger and actual profit or loss is recorded at the time of sale.

## Household Finance Notes

Crypto market values can change sharply. The valuation shown in Overview and financial statements is an estimate for understanding current household net worth. It does not fully replace tax cost basis, profit/loss calculation, moving average, total average, or fee treatment.

After large trades, separately verify the journal entries against exchange and wallet history.
