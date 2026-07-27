---
id: currencies
titleJa: 複数通貨の扱い
titleEn: Multi-Currency Handling
---

# Multi-Currency Handling

This app lets you switch among currencies enabled in Currency Settings. Currency is stored on journal lines, so foreign-currency and crypto balances can be managed separately by currency.

## Core Idea

The currency switcher at the top of the screen selects the currency used for input and display. For example, if you select USD and record a deposit of 1,000 into a USD bank account, the entry is stored in USD.

An account is not restricted to one currency. You can keep balances in multiple currencies in the same account, or create separate accounts by currency and purpose. When clear separation matters, dedicated accounts such as "USD Bank Account" and "BTC - Everyday" make balances easier to understand.

## Starting to Use a Foreign Currency

1. Enable the target currency, such as USD or EUR, in Currency Settings.
2. Select it with the currency switcher at the top of the screen.
3. If you want to separate its balance by purpose, create a dedicated account.
4. Use the opening balance form to record the current balance in the selected currency.

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

Financial statements normally show only balances in the currency selected with the currency switcher. When Include All Currencies is enabled, balances in other currencies are converted into the display currency using the rates configured in Currency Settings and then included in totals.

Converted values vary with the price source and retrieval time. The ledger retains the original currency quantities; display conversion never rewrites journal entries.

## Adding or Removing a Currency

Adding a currency does not affect existing accounts or journal entries. A currency with a remaining balance cannot be disabled, so first bring its balance to zero with transfers or currency-exchange entries when it is no longer needed.

## Crypto Assets and Currency

Crypto assets support two usage models.

- For everyday payments, enable BTC or another crypto currency in Currency Settings, select it with the currency switcher, and record ordinary income, expenses, and transfers. Create a cash account such as "BTC - Everyday" when you want its balance kept separate.
- For investment or speculation, create an account such as "BTC - Investment" in the crypto asset category and record purchases, sales, rewards, and fees as investment activity.

If your household finances are based in JPY, you do not need journal entries for crypto price movements. For a purchase, record the JPY paid and quantity acquired; for a sale, record the JPY received and quantity disposed; for a direct crypto payment, record the expense amount and quantity disposed. Currency conversion displays are reference information and do not rewrite the ledger.

You can hold the same BTC for both purposes. Separate accounts keep the balances distinct even though the currency code is the same, and Balance Reconciliation compares each account independently. Wallet quantities can be fetched into investment accounts only while BTC is selected in the header, while every account, including everyday-use accounts, supports manual actual-balance entry. See the Crypto Balance Reconciliation guide for details.
