---
id: currencies
titleJa: 複数通貨の扱い
titleEn: Multi-Currency Handling
---

# Multi-Currency Handling

This app supports multiple currencies. You can set a currency for each account, so foreign-currency bank accounts and foreign-currency assets can be included in the ledger.

## Core Idea

Each journal entry is recorded per currency. For example, a deposit of 1,000 USD into a USD bank account is recorded in USD. The app does not automatically fetch exchange rates. When recording foreign-currency transactions, enter the foreign-currency amount directly. To see a converted total in financial statements, enter a conversion entry manually.

## Creating a Foreign-Currency Account

1. In Settings, create a new account.
2. Set the account currency to the target currency, such as USD or EUR.
3. Enter the opening balance in the foreign currency using the opening balance form.

## Recording Foreign-Currency Transactions

Foreign-currency deposits and withdrawals are entered the same way as normal entries. Enter the amount in the foreign currency.

| Transaction example | How to enter |
| --- | --- |
| Deposit 1,000 USD into a USD account | Select USD account as income target, enter 1,000 |
| Pay 100 USD expense from USD account | Select USD account as expense source, enter 100 |
| Convert USD account to JPY account | Use a multi-line entry between the two accounts |

## Currency Conversion Journal Entry

When converting between a JPY account and a foreign-currency account, use a multi-line entry.

**Example: Convert 1,000 USD (acquired at 150 JPY/USD) for 145,000 JPY**

| Debit | Credit |
| --- | --- |
| Bank account (JPY) 145,000 | USD account 1,000 (cost basis 150,000 JPY equivalent) |
| Foreign exchange loss 5,000 | |

The difference between the acquisition rate and the conversion rate becomes a foreign exchange gain or loss, which is recorded as income or expense.

This app supports currency exchange entries that allow a debit/credit amount mismatch (`is_currency_exchange`). In the multi-line entry form, recording entries as currency exchange lets you save combinations of different currency amounts.

## Display in Financial Statements

In financial statement totals, balances in different currencies are shown as plain numbers side by side. For example, if you have 100,000 JPY in a JPY account and 500 USD in a USD account, the asset total shows a combined number of 100,000 + 500.

When currencies are mixed, treat totals as reference values only. For an accurate total, check converted balances manually or consolidate into a single currency by entering conversion journal entries.

## Changing a Currency

The currency of an account that already has journal entries cannot be changed. If the currency was set incorrectly, use the Bulk Edit & Replace feature to move journal entries to a different account, then delete the original account.

Adding a new currency (for example, opening a new EUR account) only requires creating a new account set to EUR. Existing accounts and journal entries are not affected.

## Crypto Assets and Currency

Crypto assets such as BTC, ETH, and SOL are also treated as a type of foreign currency. Create an account in the crypto category and set the currency to BTC or similar. Journal entries are then recorded in that crypto unit.

To check JPY-equivalent value, use Crypto Asset Watch to fetch prices from external sources and multiply by the holding quantity. See the Crypto Asset Watch guide for details.
