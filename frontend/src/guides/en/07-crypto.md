---
id: crypto
titleJa: 暗号資産の残高照合
titleEn: Crypto Balance Reconciliation
---

# Crypto Balance Reconciliation

Link wallet addresses to crypto asset accounts to compare ledger quantities with actual holdings. Manage links from Financial Statements -> Balance Reconciliation.

Fetched on-chain balances are used as actual values for reconciliation. They no longer overwrite ledger balances in financial statements; record a journal entry after reviewing any difference.

## Two Ways to Use Crypto Assets

An account's crypto category and its currency serve different purposes. The category describes why the asset is held, while the currency describes the unit used for journal entries.

| Usage model | Example setup | Main use |
| --- | --- | --- |
| Investment or speculation | Create a "BTC - Investment" account in the crypto asset category | Keep it outside everyday spending and record purchases, sales, transfers, rewards, and fees as investment activity. A wallet can be linked to fetch its actual balance |
| Everyday payment currency | Enable BTC in Currency Settings and, when useful, create a cash account such as "BTC - Everyday" | Select BTC with the currency switcher and record ordinary income, expenses, and transfers in BTC |

The two models can be used together. For example, separate "BTC - Everyday" and "BTC - Investment" accounts let you manage balances for the same BTC currency by purpose. Balance Reconciliation compares them by account instead of combining them solely by currency code.

Automatic wallet fetching is intended for accounts in the crypto category. You can still enter the actual balance of every account manually, including everyday-use accounts, and fetching does not overwrite a value you have manually edited.

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
2. Open Financial Statements -> Balance Reconciliation.
3. Add a wallet, then choose the chain, address, and linked account.
4. Choose Fetch & Apply to enter the wallet quantity as the actual balance.
5. Save and open Review Differences to compare it with the ledger quantity.

In general, one account is linked to one wallet setting. Even with the same Solana address, you may want to treat SOL, SKR, mSOL, and similar assets separately, so create separate accounts when needed.

## Market Conversion and Ledger Balances

When a crypto currency is enabled, ledger quantities are converted to the display currency using external price data. Configure the price provider under currency settings.

Financial statements use quantities calculated from journal entries. Fetched wallet quantities are used only for reconciliation, so unrecorded transfers or rewards do not silently enter the financial statements.

## Relationship With Journal Entries

Wallet linking checks actual holding quantities. It does not automatically journal purchases, sales, swaps, transfers, fees, realized gains, or realized losses.

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

Crypto balance reconciliation checks holding differences. It does not automatically journal purchases, sales, swaps, or transfers. Record actual trades separately as multi-line journal entries.

### Difference Between Actual and Ledger Balances

If wallet and ledger quantities differ, review unrecorded transfers, staking rewards, and fees. Financial statements continue to use the ledger quantity until you record an entry that resolves the difference.

For stocks, there is also no automatic monthly revaluation. The cost basis stays in the ledger and actual profit or loss is recorded at the time of sale.

## Household Finance Notes

Crypto market values can change sharply. Display-currency conversions are estimates for understanding current household net worth and do not replace tax cost basis, profit/loss calculation, moving-average, total-average, or fee treatment.

After large trades, separately verify the journal entries against exchange and wallet history.
