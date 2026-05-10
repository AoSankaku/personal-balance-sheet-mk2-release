export type Locale = "en" | "ja" | "fr" | "es" | "zh-CN" | "zh-TW";

export const translations = {
  // App
  appTitle: { en: "Personal Balance Sheet", ja: "個人バランスシート" },
  toggleColorScheme: { en: "Toggle color scheme", ja: "カラーテーマ切替" },

  // Summary cards
  assets: { en: "Assets", ja: "資産" },
  liabilities: { en: "Liabilities", ja: "負債" },
  netWorth: { en: "Net Worth", ja: "純資産" },
  income: { en: "Income", ja: "収益" },
  expenses: { en: "Expenses", ja: "費用" },
  netIncome: { en: "Net Income", ja: "純利益" },

  // Dashboard
  assetBreakdown: { en: "Asset Breakdown", ja: "資産内訳" },
  noAssetBalancesYet: {
    en: "No asset balances yet.",
    ja: "資産残高がまだありません。",
  },
  addAccountBtn: { en: "+ Add Account", ja: "+ 勘定科目を追加" },
  addTransactionBtn: { en: "+ Add Transaction", ja: "+ 取引を追加" },
  balanceSheetTitle: { en: "Balance Sheet", ja: "貸借対照表" },
  plTitle: { en: "P&L", ja: "損益計算書" },
  settingsSectionGeneral: { en: "General", ja: "一般" },
  settingsSectionAccounts: { en: "Accounts", ja: "勘定科目" },
  sectionAssets: { en: "Assets", ja: "資産" },
  sectionDepreciableAssets: {
    en: "Fixed Assets (Depreciable)",
    ja: "固定資産（減価償却対象）",
  },
  sectionLiabilities: { en: "Liabilities", ja: "負債" },
  sectionEquity: { en: "Equity", ja: "資本" },
  sectionIncome: { en: "Income", ja: "収益" },
  sectionExpenses: { en: "Expenses", ja: "費用" },
  failedToLoadData: {
    en: "Failed to load data",
    ja: "データの読み込みに失敗しました",
  },
  errorTitle: { en: "Error", ja: "エラー" },
  reload: { en: "Reload", ja: "再読み込み" },
  internalServerError: {
    en: "Internal Server Error",
    ja: "内部サーバーエラー",
  },

  // Notifications
  accountAdded: { en: "Account added", ja: "勘定科目を追加しました" },
  accountDeleted: { en: "Account deleted", ja: "勘定科目を削除しました" },
  transactionAdded: { en: "Transaction added", ja: "取引を追加しました" },
  transactionDeleted: { en: "Transaction deleted", ja: "取引を削除しました" },
  statusLabel: { en: "Status", ja: "状態" },
  statusDismiss: { en: "OK", ja: "閉じる" },

  // AccountTable
  total: { en: "Total:", ja: "合計:" },
  thAccount: { en: "Account", ja: "勘定科目" },
  thCategory: { en: "Category", ja: "カテゴリー" },
  thCurrency: { en: "Currency", ja: "通貨" },
  thBalance: { en: "Balance", ja: "残高" },
  noAccountsYet: { en: "No accounts yet.", ja: "勘定科目がまだありません。" },
  deleteAccount: { en: "Delete account", ja: "勘定科目を削除" },

  // Category labels (shared by AccountTable + AddAccountModal)
  catCash: { en: "Cash / Bank", ja: "現金・預金" },
  catInvestment: { en: "Investment", ja: "投資" },
  catProperty: { en: "Property", ja: "不動産" },
  catLoan: { en: "Long-term Borrowing", ja: "長期借入" },
  catCreditCard: { en: "Credit Card", ja: "クレジットカード" },
  catShortTermLoan: { en: "Short-term Loan", ja: "短期借入" },
  catOpeningBalance: { en: "Opening Balance", ja: "期首残高" },
  catSalary: { en: "Salary", ja: "給与" },
  catBusiness: { en: "Business", ja: "事業収入" },
  catInvestmentIncome: { en: "Investment Income", ja: "投資収入" },
  catFood: { en: "Food & Dining", ja: "食費" },
  catRent: { en: "Rent / Housing", ja: "家賃・住居費" },
  catTransport: { en: "Transport", ja: "交通費" },
  catUtilities: { en: "Utilities", ja: "光熱費" },
  catEntertainment: { en: "Entertainment", ja: "娯楽費" },
  catOther: { en: "Other", ja: "その他" },
  catCrypto: { en: "Crypto", ja: "暗号資産" },
  catLending: { en: "Short-term Lending", ja: "短期貸付" },
  catShortTermLending: { en: "Short-term Lending", ja: "短期貸付" },
  catLongTermLending: { en: "Long-term Lending", ja: "長期貸付" },
  catLongTermLoan: { en: "Long-term Borrowing", ja: "長期借入" },
  catBusinessAdvance: { en: "Business Advance", ja: "事業立替" },
  catDailyGoods: { en: "Daily Goods", ja: "生活雑費" },
  catSocial: { en: "Social Expenses", ja: "交際費" },
  catInvestmentLoss: { en: "Investment Loss", ja: "投資損失" },

  // AddAccountModal / EditAccountModal
  addAccountTitle: { en: "Add Account", ja: "勘定科目を追加" },
  editAccountTitle: { en: "Edit Account", ja: "勘定科目を編集" },
  editAccount: { en: "Edit", ja: "編集" },
  accountUpdated: { en: "Account updated", ja: "勘定科目を更新しました" },
  accountNameLabel: { en: "Account Name", ja: "勘定科目名" },
  accountNamePlaceholder: { en: "e.g. SBI Savings", ja: "例: SBI普通預金" },
  typeLabel: { en: "Type", ja: "種類" },
  categoryLabel: { en: "Category", ja: "カテゴリー" },
  currencyLabel: { en: "Currency", ja: "通貨" },
  cancel: { en: "Cancel", ja: "キャンセル" },
  confirm: { en: "Confirm", ja: "確認" },
  nameIsRequired: { en: "Name is required", ja: "名前は必須です" },
  nameConflictAccount: {
    en: "This name is already used by an account",
    ja: "この名前はすでに勘定科目で使用されています",
  },
  nameConflictBudgetCategory: {
    en: "This name is already used by a budget category",
    ja: "この名前はすでに予算カテゴリで使用されています",
  },
  typeAsset: { en: "Asset", ja: "資産" },
  typeLiability: { en: "Liability", ja: "負債" },
  typeEquity: { en: "Equity", ja: "資本" },
  typeIncome: { en: "Income", ja: "収益" },
  typeExpense: { en: "Expense", ja: "費用" },

  // JournalModal
  addTransactionTitle: { en: "Add Transaction", ja: "仕訳を追加" },
  tabSimple: { en: "Simple", ja: "シンプル" },
  tabMultiLine: { en: "Multi-line", ja: "複合仕訳" },
  dateLabel: { en: "Date", ja: "日付" },
  descriptionLabel: { en: "Description", ja: "摘要" },
  descSimplePlaceholder: {
    en: "e.g. Grocery shopping",
    ja: "例: 食料品の買い物",
  },
  descMultiPlaceholder: { en: "e.g. Payroll", ja: "例: 給与支払い" },
  debitAccountLabel: { en: "Debit account (increase)", ja: "借方（増加）" },
  creditAccountLabel: { en: "Credit account (decrease)", ja: "貸方（減少）" },
  selectAccount: { en: "Select account", ja: "勘定科目を選択" },
  amountLabel: { en: "Amount", ja: "金額" },
  multiAccountColHeader: { en: "Account", ja: "勘定科目" },
  debitColHeader: { en: "Debit", ja: "借方" },
  creditColHeader: { en: "Credit", ja: "貸方" },
  addRow: { en: "Add row", ja: "行を追加" },
  totalDebit: { en: "Total debit:", ja: "借方合計:" },
  totalCredit: { en: "Total credit:", ja: "貸方合計:" },
  unbalanced: { en: "⚠ Unbalanced", ja: "⚠ 貸借不一致" },
  add: { en: "Add", ja: "追加" },
  descriptionIsRequired: {
    en: "Description is required",
    ja: "摘要は必須です",
  },
  selectDebitAccount: {
    en: "Select debit account",
    ja: "借方の勘定科目を選択してください",
  },
  selectCreditAccount: {
    en: "Select credit account",
    ja: "貸方の勘定科目を選択してください",
  },
  amountMustBePositive: {
    en: "Amount must be positive",
    ja: "金額は正の値にしてください",
  },

  // JournalTable
  recentJournalEntries: { en: "Recent Journal Entries", ja: "最近の仕訳" },
  rowsPerPage: { en: "Rows per page", ja: "1ページ件数" },
  pageSummary: {
    en: "{from}-{to} of {total}",
    ja: "{total}件中 {from}-{to}件",
  },
  thDate: { en: "Date", ja: "日付" },
  thDescription: { en: "Description", ja: "摘要" },
  thDebit: { en: "Debit", ja: "借方" },
  thCredit: { en: "Credit", ja: "貸方" },
  thSource: { en: "Source", ja: "入力元" },
  thCreatedAt: { en: "Input At", ja: "入力日時" },
  showInputTimestamp: { en: "Show timestamp", ja: "入力日時を表示" },
  journalSourceManual: { en: "Manual", ja: "手動" },
  journalSourceCsvImport: { en: "CSV Import", ja: "CSVインポート" },
  noTransactionsYet: {
    en: "No transactions yet.",
    ja: "取引がまだありません。",
  },
  deleteEntry: { en: "Delete entry", ja: "仕訳を削除" },
  recentTransactions: { en: "Recent Transactions", ja: "最近の取引" },
  showMore: { en: "Show more", ja: "もっと見る" },
  showAllTransactions: { en: "Show all", ja: "すべて見る" },
  budgetImpact: { en: "Budget", ja: "予算" },

  // ExpenseBarChart
  expenseChartTitle: { en: "Monthly Expenses", ja: "月別費用" },
  noExpenseDataYet: {
    en: "No expense data yet.",
    ja: "費用データがまだありません。",
  },

  // BsHistoryChart
  bsTrendTitle: { en: "Balance Sheet Trend", ja: "貸借対照表の推移" },
  bsChartTotalAssets: { en: "Total Assets", ja: "資産合計" },
  bsChartTotalLiabilities: { en: "Total Liabilities", ja: "負債合計" },
  bsChartSelectLabel: { en: "Select series", ja: "系列を選択" },
  bsChartStacked: { en: "Stacked", ja: "積み上げ" },
  bsChartTotals: { en: "Totals", ja: "合計" },

  // NetWorthChart
  netWorthOverTime: { en: "Net Worth Over Time", ja: "純資産の推移" },
  chartAssets: { en: "Assets", ja: "資産" },
  chartLiabilities: { en: "Liabilities", ja: "負債" },
  chartNetWorth: { en: "Net Worth", ja: "純資産" },
  chartViewAll: { en: "All", ja: "全表示" },
  chartViewAssetsLiabilities: { en: "Assets & Liabilities", ja: "資産・負債" },
  chartViewNetWorth: { en: "Net Worth", ja: "純資産" },
  granularityYear: { en: "Year", ja: "年" },
  granularityMonth: { en: "Month", ja: "月" },
  granularityDay: { en: "Day", ja: "日" },
  includeFutureData: {
    en: "Include future data",
    ja: "未来のデータも含める",
  },
  reset: { en: "Reset", ja: "リセット" },
  resetConfirm: {
    en: "Reset the form? Your draft will be cleared.",
    ja: "フォームをリセットしますか？入力内容が消去されます。",
  },

  // CryptoPortfolio
  cryptoPortfolio: { en: "Crypto Portfolio", ja: "暗号資産ポートフォリオ" },
  addWallet: { en: "+ Add Wallet", ja: "+ ウォレットを追加" },
  walletAddress: { en: "Wallet Address", ja: "ウォレットアドレス" },
  detectedChain: { en: "Detected Chain", ja: "検出チェーン" },
  estMarketValue: { en: "Est. Market Value", ja: "推定市場価値" },
  coinPrice: { en: "Coin Price", ja: "コイン価格" },
  quantity: { en: "Quantity", ja: "数量" },
  fetchBalance: { en: "Fetch Balance", ja: "残高を取得" },
  invalidAddress: { en: "Invalid address", ja: "アドレスが無効です" },
  noWalletsYet: { en: "No wallets yet.", ja: "ウォレットがまだありません。" },
  deleteWallet: { en: "Delete wallet", ja: "ウォレットを削除" },
  walletLinked: { en: "Wallet linked", ja: "ウォレットを登録しました" },
  thChain: { en: "Chain", ja: "チェーン" },
  thAddress: { en: "Address", ja: "アドレス" },
  thQuantity: { en: "Quantity", ja: "数量" },
  thEstValue: { en: "Est. Value", ja: "推定価値" },
  linkAccount: { en: "Link Account", ja: "勘定科目を紐付け" },
  refresh: { en: "Refresh", ja: "更新" },
  cryptoPrices: { en: "Crypto Prices (JPY)", ja: "暗号資産価格（円）" },
  thTicker: { en: "Ticker", ja: "ティッカー" },
  thPrice: { en: "Price (JPY)", ja: "価格（円）" },
  pricesNotLoaded: {
    en: "Prices not yet loaded.",
    ja: "価格がまだ読み込まれていません。",
  },

  // Navigation
  navOverview: { en: "Overview", ja: "概要" },
  navInput: { en: "Input", ja: "入力" },
  navAssets: { en: "Assets", ja: "資産" },
  navLedger: { en: "Ledger", ja: "帳簿" },
  navCrypto: { en: "Crypto", ja: "暗号資産" },
  navReports: { en: "Reports", ja: "レポート" },
  navSettings: { en: "Settings", ja: "設定" },

  // Household-mode simple entry
  transactionTypeExpense: { en: "Expense", ja: "支出" },
  transactionTypeIncome: { en: "Income", ja: "収入" },
  transactionTypeTransfer: { en: "Transfer", ja: "振替" },
  transactionTypeInitial: { en: "Initial Input", ja: "初期残高入力" },
  initialAssetAccountLabel: { en: "Account", ja: "口座" },
  openingBalanceAccountName: { en: "Opening Balance", ja: "期首残高" },
  paidFromLabel: { en: "Paid from", ja: "支払元" },
  depositedToLabel: { en: "Deposited to", ja: "入金先" },
  fromAccountLabel: { en: "From account", ja: "送金元" },
  toAccountLabel: { en: "To account", ja: "送金先" },
  incomeTypeLabel: { en: "Income type", ja: "収入の種類" },

  transferBudgetSourceLabel: { en: "Budget source", ja: "予算送金元" },
  transferBudgetDestinationLabel: { en: "Budget destination", ja: "予算送金先" },
  transferBudgetNoMovementPlaceholder: {
    en: "No budget movement",
    ja: "予算移動なし",
  },
  transferBudgetDisappearPlaceholder: {
    en: "Disappear",
    ja: "消滅",
  },
  budgetAdjustNoteLabel: { en: "Comment", ja: "コメント" },
  budgetAdjustNotePlaceholder: {
    en: "Optional note for this budget adjustment",
    ja: "この予算調整の任意メモ",
  },
  budgetHistoryNoteCol: { en: "Comment", ja: "コメント" },

  // Date-range filter
  filterThisMonth: { en: "This Month", ja: "今月" },
  filterLastMonth: { en: "Last Month", ja: "先月" },
  filterAll: { en: "All", ja: "すべて" },

  // LedgerPage filter accordion
  filterPanel: { en: "Filter", ja: "絞り込み" },
  filterActiveCount: { en: "{n} active", ja: "{n}件適用中" },
  filterDescriptionLabel: { en: "Description", ja: "摘要" },
  filterDescriptionPlaceholder: {
    en: "Search description…",
    ja: "摘要で検索…",
  },
  filterSourceLabel: { en: "Source", ja: "入力元" },
  filterSourceAll: { en: "All sources", ja: "すべての入力元" },
  filterAmountLabel: { en: "Amount Range", ja: "金額範囲" },
  filterAmountMin: { en: "Min", ja: "最小" },
  filterAmountMax: { en: "Max", ja: "最大" },
  filterAccountLabel: { en: "Account", ja: "勘定科目" },
  filterAccountPlaceholder: { en: "All accounts", ja: "すべての勘定科目" },
  filterCreatedRangeLabel: {
    en: "Input Timestamp Range",
    ja: "入力日時の範囲",
  },
  filterClearAll: { en: "Clear", ja: "クリア" },
  outsideDateRangeMsg: {
    en: "{n} entries outside selected date range",
    ja: "指定日付範囲外の仕訳 {n}件",
  },
  clearDateFilter: { en: "[Clear date filter]", ja: "【日付指定解除】" },

  // OverviewPage (budget)
  availableBalance: { en: "Available Balance", ja: "使える残高" },
  carryover: { en: "Carryover", ja: "繰越" },
  budgetResetBadge: { en: "Reset", ja: "リセット" },
  used: { en: "used", ja: "使用済み" },
  budget: { en: "budget", ja: "予算" },
  noBudgetCategories: {
    en: "No budget categories yet. Go to Settings to add one.",
    ja: "予算カテゴリがありません。設定から追加してください。",
  },

  // InputPage
  inputPageTitle: { en: "Add Transaction", ja: "取引を入力" },
  transactionSaved: { en: "Transaction saved", ja: "取引を保存しました" },

  // LedgerPage view toggle
  viewSimple: { en: "Simple", ja: "シンプル" },
  viewDoubleEntry: { en: "Double-entry", ja: "複式簿記" },

  // Budget settings
  budgetTitle: { en: "Budget", ja: "予算" },
  addBudgetCategory: {
    en: "+ Add Budget Category",
    ja: "+ 予算カテゴリを追加",
  },
  budgetCategoryName: { en: "Category Name", ja: "カテゴリ名" },
  budgetRollover: {
    en: "Carry over unused budget to next month",
    ja: "未使用予算を翌月に繰り越す",
  },
  budgetLinkedAccounts: {
    en: "Linked Expense Accounts",
    ja: "連携する費用科目",
  },
  budgetFixedAmount: { en: "Fixed Amount (¥)", ja: "固定金額（¥）" },
  budgetIncomeRatio: { en: "Income Ratio (%)", ja: "収入比率（%）" },
  budgetAdhocAmount: { en: "One-time Addition (¥)", ja: "今月の追加金額（¥）" },
  editBudgetCategory: { en: "Edit", ja: "編集" },
  archiveBudgetCategory: { en: "Archive", ja: "アーカイブ" },
  restoreBudgetCategory: { en: "Restore", ja: "復元" },
  showArchivedBudgetCategories: {
    en: "Show archived",
    ja: "アーカイブ済みを表示",
  },
  archivedBudgetCategoryBadge: { en: "Archived", ja: "アーカイブ済み" },
  deleteBudgetCategory: { en: "Delete", ja: "削除" },
  saveBudgetCategory: { en: "Save", ja: "保存" },

  // Expense account budget ratio settings
  budgetDistributionLabel: {
    en: "Budget Distribution",
    ja: "予算配分",
  },
  budgetDistributionHint: {
    en: "Set what % of this expense counts toward each budget category.",
    ja: "この費用が各予算カテゴリに何％消費されるかを設定します。",
  },
  budgetDistributionTotal: { en: "Total", ja: "合計" },
  defaultPaymentSource: {
    en: "Default payment source",
    ja: "規定の支払元",
  },
  defaultPaymentSourceHint: {
    en: "Pre-fill the 'Paid from' field when entering expenses.",
    ja: "支出入力時の「支払元」を自動入力します。",
  },
  preferredPaymentMethod: {
    en: "Preferred payment method",
    ja: "支払い優先口座",
  },
  preferredPaymentMethodHint: {
    en: "This account is pre-selected and shown first in 'Paid from'.",
    ja: "支出入力時に「支払元」として最初に表示・選択されます。",
  },
  preferredPaymentMethodNone: {
    en: "No preference",
    ja: "指定なし",
  },
  preferredFilterTitle: {
    en: "Preferred budget distribution filters",
    ja: "優先予算配分フィルター",
  },
  preferredFilterHint: {
    en: "These budget distribution filters appear first (★ group) in the income entry dropdown.",
    ja: "収入入力時のフィルター選択で先頭（★グループ）に表示されます。",
  },
  preferredFilterNone: {
    en: "No filter",
    ja: "指定なし",
  },
  budgetAllocationDisplay: {
    en: "Budget distribution",
    ja: "予算配分",
  },
  budgetDistOtherCategories: {
    en: "Other categories",
    ja: "その他のカテゴリ",
  },

  // Budget adjustment (InputPage)
  tabBudgetAdjust: { en: "Budget Adj.", ja: "予算調整" },
  budgetCategoryLabel: { en: "Budget Category", ja: "予算カテゴリ" },
  budgetAdjustAmountLabel: {
    en: "Adjustment amount (+ add / − reduce)",
    ja: "調整額（＋追加 / −減額）",
  },
  budgetAdjusted: { en: "Budget adjusted", ja: "予算を調整しました" },
  budgetResetToZeroButton: {
    en: "Budget reset (balance 0)",
    ja: "予算リセット（残高0）",
  },
  archiveBudgetCategoryAfterReset: {
    en: "Archive this budget category after reset",
    ja: "リセット後にこの予算科目をアーカイブ",
  },

  // SimpleEntryForm
  expenseSubAccountLabel: { en: "Expense account", ja: "費用科目" },

  // OverviewPage date filter
  asOfDate: { en: "As of", ja: "この日時点" },

  // Loan/repayment entry (SimpleEntryForm)
  transactionTypeLoan: { en: "Loan/Repay", ja: "貸し借り" },
  loanIncrease: { en: "Borrow (Liability ↑)", ja: "借入（負債増加）" },
  loanDecrease: { en: "Repay (Liability ↓)", ja: "返済（負債減少）" },
  loanLend: { en: "Lend (Asset ↑)", ja: "貸付（資産増加）" },
  loanCollect: { en: "Collect (Asset ↓)", ja: "回収（資産減少）" },
  liabilityAccountLabel: { en: "Liability account", ja: "負債科目" },
  lendingAccountLabel: { en: "Lending account", ja: "貸付科目" },
  loanCounterIncrease: { en: "Deposit destination", ja: "入金先" },
  loanCounterIncreaseExpense: {
    en: "Expense covered by loan",
    ja: "充当した費用",
  },
  loanCounterIncreaseLiability: { en: "Liability settled", ja: "充当先の負債" },
  loanCounterDecrease: { en: "Payment account", ja: "支払い元" },
  loanCounterDecreaseLiability: { en: "Liability used", ja: "使用した負債" },
  loanCounterDecreaseIncome: { en: "Forgiven (income)", ja: "免除（収益）" },
  loanCounterLend: { en: "Lending source", ja: "貸し出し元" },
  loanCounterLendLiability: { en: "Liability used", ja: "使用した負債" },
  loanCounterCollect: { en: "Receiving account", ja: "受け取り口座" },
  loanCounterExpenseCovered: { en: "Expense covered by them", ja: "立替費用" },
  selectSettlementEntries: {
    en: "Select entries to settle",
    ja: "完済とする取引を選択",
  },
  settlementSelectedTotal: { en: "Selected total", ja: "選択合計" },
  noUnsettledEntries: {
    en: "No unsettled entries",
    ja: "未完済の取引はありません",
  },
  loanDifferenceIncome: { en: "Gain (income account)", ja: "差益（収益科目）" },
  loanDifferenceLoss: { en: "Loss (expense account)", ja: "差損（費用科目）" },
  loanDifferenceAccountLabel: { en: "Difference account", ja: "差額科目" },
  completedAccountsSection: { en: "Completed accounts", ja: "完了した科目" },

  // Initial balance tab (InputPage)
  tabInitialBalance: { en: "Initial Balance", ja: "初期残高入力" },
  initialBalanceHint: {
    en: "Record opening balances for accounts when starting out.",
    ja: "口座の初期残高を記録します。初回セットアップ時に使用します。",
  },
  collapse: { en: "Collapse ▲", ja: "閉じる ▲" },
  autoGeneratedDescription: {
    en: "Description (auto-generated):",
    ja: "摘要（自動生成）:",
  },

  // BudgetFilterModal
  copyFromExistingLabel: {
    en: "Copy from existing filter",
    ja: "既存のフィルターから複製",
  },
  copyFromExistingPlaceholder: {
    en: "Select a filter to copy (optional)",
    ja: "複製元を選択（任意）",
  },
  noRemainderWarningTitle: {
    en: "No Ratio Distribution step",
    ja: "割合分配ステップなし",
  },
  noRemainderWarning: {
    en: "If 'Ratio Distribution' is not placed last, unallocated cash will remain after entering income. This can be manually allocated to budget categories later, but since used filters cannot be edited, you will need to create a new filter if changes are needed.",
    ja: "『割合分配』を最後に配置しない場合、収入を入力したあとに予算に割り当てない現金が発生します。これらはあとから手動で他の予算に割り当てることもできますが、一度使用したフィルターはあとから編集できないため、変更の必要がある場合は新しく作成する必要があります。",
  },
  noRemainderWarningConfirm: {
    en: "Save anyway",
    ja: "このまま保存",
  },

  // Budget adjustment log
  budgetAdjustDateLabel: { en: "Date", ja: "日付" },
  budgetHistoryTitle: {
    en: "Budget Adjustment History",
    ja: "予算増減履歴",
  },
  noBudgetHistory: {
    en: "No budget adjustments yet.",
    ja: "予算調整履歴がありません。",
  },
  budgetHistoryAmountCol: { en: "Amount", ja: "金額" },

  // Income distribution preview
  budgetDistributionPreview: {
    en: "Distribution preview",
    ja: "配分プレビュー",
  },
  budgetFilterDefaultLabel: {
    en: "Filter pipeline",
    ja: "フィルター配分",
  },
  filterStepFixed: {
    en: "Fixed",
    ja: "固定",
  },
  filterStepCapped: {
    en: "Capped",
    ja: "上限付き",
  },
  filterStepRemainder: {
    en: "Remainder",
    ja: "残余",
  },
  filterStepRemaining: {
    en: "remaining",
    ja: "残り",
  },
  budgetDistributionPreviewUnallocated: {
    en: "Unallocated",
    ja: "未配分",
  },

  // Multi-line entry budget ratios
  multiLineBudgetRatios: {
    en: "Budget allocation",
    ja: "予算配分",
  },
  multiLineBudgetAllocHint: {
    en: "＋ adds to budget  ／  − reduces budget",
    ja: "＋ 予算を増やす  ／  − 予算を減らす",
  },

  dateRangePlaceholder: { en: "Select range", ja: "期間を選択" },

  // Budget settings (rollover period)
  rolloverMonthsLabel: { en: "Rollover Period", ja: "繰り越し期間" },
  rolloverMonthsUnit: { en: "months", ja: "ヶ月" },
  rolloverMonthsDesc: {
    en: "Max months to carry over unused budget (1–24)",
    ja: "未使用予算を引き継ぐ最大月数（1〜24ヶ月）",
  },
  budgetSettingsTitle: { en: "Budget Settings", ja: "予算の設定" },
  budgetSettingsSaved: {
    en: "Budget settings saved",
    ja: "予算設定を保存しました",
  },

  // LedgerPage table view
  budgetHistoryJournalTab: { en: "Recent Transactions", ja: "最近の仕訳" },
  budgetHistoryBudgetTab: { en: "Budget History", ja: "予算増減履歴" },
  tabBalanceSheet: { en: "B/S", ja: "貸借対照表" },
  tabBalanceSheetDesc: {
    en: "Assets, liabilities & equity",
    ja: "資産・負債・純資産",
  },
  tabPL: { en: "P&L", ja: "損益計算書" },
  tabPLDesc: { en: "Income & expense overview", ja: "収益・費用の概要" },
  navCryptoDesc: {
    en: "Wallet balances & portfolio",
    ja: "ウォレット残高・ポートフォリオ",
  },
  filterThisYear: { en: "This Year", ja: "今年" },
  navFS: { en: "Financials", ja: "財務諸表" },

  // PlPage rate columns
  plPerYear: { en: "Per Year", ja: "年換算" },
  plPerMonth: { en: "Per Month", ja: "月換算" },
  plPerDay: { en: "Per Day", ja: "日換算" },
  plTotal: { en: "Period Total", ja: "期間合計" },
  plGoToCurrent: { en: "Current", ja: "現在" },
  granularityQuarter: { en: "Quarter", ja: "四半期" },
  granularityHalf: { en: "Half", ja: "半期" },
  budgetHistorySourceIncome: { en: "Income", ja: "収入" },
  budgetHistorySourceTransfer: { en: "Transfer", ja: "振替" },
  budgetHistorySourceManual: { en: "Manual", ja: "手動" },
  budgetHistorySourceReset: { en: "Reset", ja: "リセット" },
  budgetHistorySourceSimple: { en: "Simple Input", ja: "シンプル入力" },
  budgetHistorySourceMultiline: { en: "Multi-line", ja: "複合仕訳" },
  accountName: { en: "Account", ja: "口座" },
  budgetTargetAccountsLabel: { en: "Target Accounts", ja: "目標保管口座" },
  budgetTargetAccountsDesc: {
    en: "Used for placement guidance only. Linked budgets and accounts are grouped and compared by total balance.",
    ja: "予算の置き場所の目安です。紐づけた各口座に予算額の全額が表示されます。",
  },
  budgetTargetManyToManyError: {
    en: "This would create a many-to-many placement. Use either one budget with multiple accounts, or multiple budgets with one account.",
    ja: "多対多の予算配置になります。1つの予算を複数口座に置くか、複数予算を1つの口座に置く形にしてください。",
  },
  budgetPlacementTitle: { en: "Budget Placement", ja: "予算配置" },
  budgetPlacementExpected: { en: "Target", ja: "目標額" },
  budgetPlacementActual: { en: "Actual", ja: "実残高" },
  budgetPlacementDifference: { en: "Difference", ja: "差分" },
  budgetPlacementUnplaced: { en: "Unplaced", ja: "未配置" },
  budgetPlacementEmpty: {
    en: "No target accounts are configured.",
    ja: "目標保管口座が設定されていません。",
  },
  budgetPlacementHintsTitle: { en: "Hints", ja: "ヒント" },
  budgetHistoryTypeCol: { en: "Type", ja: "種別" },
  budgetHistoryModeEntries: { en: "Entries", ja: "明細" },
  budgetHistoryModeCategories: { en: "By Budget", ja: "予算別" },
  budgetHistoryCategorySummaryCount: {
    en: "{count} budget categories",
    ja: "{count} 件の予算",
  },
  budgetHistoryEntryCount: { en: "{count} entries", ja: "{count} 件" },
  budgetHistoryLatestInput: { en: "Latest input", ja: "最新入力" },
  budgetHistoryAdjustedTotal: {
    en: "Budget Amount",
    ja: "予算額",
  },
  budgetHistoryPeriodRunningTotal: {
    en: "Range Total",
    ja: "期間内累計",
  },
  budgetHistoryInputTimestamp: { en: "Input Time", ja: "入力日時" },

  // Adjustment log edit/delete
  deleteAdjustmentLog: { en: "Delete Adjustment", ja: "調整履歴を削除" },
  deleteAdjustmentLogConfirm: {
    en: "Delete this adjustment?",
    ja: "この調整履歴を削除しますか？",
  },
  deleteIncomeChunk: { en: "Delete Income Allocation", ja: "収入配分を削除" },
  deleteIncomeChunkConfirm: {
    en: "This will remove the budget allocations for all {count} categories (¥{total} total) linked to this income entry. The income transaction itself will not be deleted.",
    ja: "この収入に紐づく {count} カテゴリ分の予算配分（合計 ¥{total}）をすべて削除します。収入仕訳自体は削除されません。",
  },
  incomeAllocationDeleted: {
    en: "Income allocation removed",
    ja: "収入配分を削除しました",
  },
  adjustmentLogDeleted: {
    en: "Adjustment deleted",
    ja: "調整履歴を削除しました",
  },
  adjustmentLogUpdated: {
    en: "Adjustment updated",
    ja: "調整履歴を更新しました",
  },
  editLabel: { en: "Edit", ja: "編集" },
  editTransactionTitle: { en: "Edit Transaction", ja: "仕訳を編集" },
  save: { en: "Save", ja: "保存" },

  // Crypto price refresh
  refreshPrices: { en: "Refresh prices", ja: "価格を更新" },

  // Payday settings (income accounts)
  paydayLabel: { en: "Payday (day of month)", ja: "給料日（月の何日）" },
  paydayHint: {
    en: "A notification will appear if no income is recorded by this day each month.",
    ja: "毎月この日までに収入が入力されていない場合、通知が表示されます。",
  },

  // Notification bell
  noNotifications: { en: "No notifications", ja: "通知はありません" },
  notificationPaydayUnrecorded: {
    en: "Payday not yet recorded",
    ja: "未入力の給料日",
  },
  notifications: { en: "Notifications", ja: "通知" },
  settingsSectionNotifications: { en: "Notifications", ja: "通知設定" },
  notifPaydayToggle: {
    en: "Payday reminder",
    ja: "給料日リマインダー",
  },
  notifPaydayToggleHint: {
    en: "Show a bell alert when payday income hasn't been recorded yet.",
    ja: "給料日に収入が未入力の場合、ベル通知を表示します。",
  },
  notifCreditCardToggle: {
    en: "Credit card import reminder",
    ja: "クレジットカード明細リマインダー",
  },
  notifCreditCardToggleHint: {
    en: "Show a banner on the overview page when a credit card statement is ready to import.",
    ja: "クレジットカード明細のインポートが必要な場合、概要ページにバナーを表示します。",
  },
  notifCreditCardWithdrawalRiskToggle: {
    en: "Credit card withdrawal balance alert",
    ja: "クレジットカード引き落とし残高アラート",
  },
  notifCreditCardWithdrawalRiskToggleHint: {
    en: "Show a bell alert from 14 days before withdrawal when linked bank balance may go negative after credit card payments.",
    ja: "引き落とし日の14日前から、紐付けた口座がクレジットカード引き落とし後にマイナスになる恐れがある場合にベル通知を表示します。",
  },
  notifBudgetNegativeToggle: {
    en: "Budget over-allocation alert",
    ja: "予算過剰割当アラート",
  },
  notifBudgetNegativeToggleHint: {
    en: "Show a bell alert when total budget allocations exceed your actual assets, making your budget unreliable.",
    ja: "予算の割当合計が実際の資産を超え、予算が意味をなさなくなったときにベル通知を表示します。",
  },
  notificationBudgetNegative: {
    en: "Your budget allocations exceed your total assets. This may be caused by a duplicate or forgotten entry — your budget figures are no longer reliable until this is corrected.",
    ja: "予算の割当合計が総資産を超えています。入力の重複や漏れが原因の可能性があります。修正するまで予算の数値は正確ではありません。",
  },
  notifLoanOverdueToggle: {
    en: "Overdue short-term loan/debt alert",
    ja: "短期貸付・借入の滞納アラート",
  },
  notifLoanOverdueToggleHint: {
    en: "Show a bell alert when no repayment/collection has occurred for the specified number of days.",
    ja: "指定した日数以上、返済・回収が行われていない短期貸付・借入がある場合に通知します。",
  },
  notifLoanOverdueDaysLabel: {
    en: "Threshold (days)",
    ja: "しきい値（日数）",
  },
  notifAccountNegativeToggle: {
    en: "Negative account balance alert",
    ja: "勘定科目マイナス残高アラート",
  },
  notifAccountNegativeToggleHint: {
    en: "Show a bell alert when an account balance goes negative (excludes unknown funds).",
    ja: "勘定科目の残高がマイナスになった場合に通知します（不明金を除く）。",
  },
  notificationLoanOverdueSection: {
    en: "Overdue loans / debts",
    ja: "未処理の短期貸付・借入",
  },
  notificationLoanOverdueDays: {
    en: "{days} days ago",
    ja: "{days}日以上未処理",
  },
  notificationAccountNegativeSection: {
    en: "Negative account balances",
    ja: "マイナス残高の勘定科目",
  },
  notificationCreditCardWithdrawalRiskSection: {
    en: "Credit card withdrawals may overdraw",
    ja: "クレジットカード引き落とし残高不足",
  },
  notificationCreditCardWithdrawalRiskDetail: {
    en: "{date} from {account}: {amount}",
    ja: "{date} {account} から {amount}",
  },

  // Account deletion safety
  accountInUse: { en: "Account in use", ja: "使用中の勘定科目" },
  accountInUseMsg: {
    en: "This account is used in journal entries or has a linked wallet. Select a replacement account of the same type.",
    ja: "このアカウントは仕訳またはウォレットで使用されています。同じ種類の代替勘定科目を選択してください。",
  },
  replaceWith: { en: "Replace with", ja: "置換先" },
  replaceAndDelete: { en: "Replace & Delete", ja: "置換して削除" },

  // Credit card settings (AddAccountModal)
  creditCardDatesLabel: { en: "Statement Settings", ja: "明細設定" },
  closingDayLabel: { en: "Closing day", ja: "締め日" },
  closingDayEndOfMonth: { en: "End of month", ja: "月末" },
  confirmationDayLabel: {
    en: "Confirmation day",
    ja: "確定日",
  },
  withdrawalDayLabel: {
    en: "Withdrawal day",
    ja: "引き落とし日",
  },
  withdrawalAccountLabel: {
    en: "Withdrawal account",
    ja: "引き落とし口座",
  },
  withdrawalAccountHint: {
    en: "Used for withdrawal balance alerts.",
    ja: "引き落とし残高アラートに使用します。",
  },
  withdrawalAccountPlaceholder: {
    en: "Select account",
    ja: "口座を選択",
  },
  billingOffsetMonthsLabel: {
    en: "Billing month offset",
    ja: "請求月オフセット",
  },
  billingOffsetMonthsHint: {
    en: "Extra months after the usual next-month withdrawal. 0 means the normal next-month withdrawal.",
    ja: "通常の翌月引き落としに追加する月数です。0 で通常の翌月引き落としになります。",
  },
  creditCardStatementOffsetLabel: {
    en: "Transaction billing offset",
    ja: "取引ごとの請求オフセット",
  },
  creditCardStatementOffsetHint: {
    en: "Extra months after the normal cycle for this transaction. 0 means the usual next-month withdrawal.",
    ja: "この取引だけ通常サイクルに追加する月数です。0 で通常の翌月引き落としになります。",
  },
  creditCardStatementOffsetShort: {
    en: "Offset",
    ja: "オフセット",
  },

  // CSV Import (ImportPage)
  importPageTitle: { en: "Import CSV", ja: "CSVインポート" },
  importUploadLabel: { en: "Upload CSV file", ja: "CSVファイルをアップロード" },
  importDetectedFormat: { en: "Detected format", ja: "検出された形式" },
  importSelectFormat: { en: "Select format manually", ja: "形式を手動で選択" },
  importFormatSmbcDraft: { en: "SMBC (Draft)", ja: "三井住友カード（仮版）" },
  importFormatSmbcConfirmed: {
    en: "SMBC (Confirmed)",
    ja: "三井住友カード（確定版）",
  },
  importFormatRakutenDraft: { en: "Rakuten (Draft)", ja: "楽天カード（仮版）" },
  importFormatRakutenConfirmed: {
    en: "Rakuten (Confirmed)",
    ja: "楽天カード（確定版）",
  },
  importFormatUnknown: { en: "Unknown format", ja: "形式不明" },
  importFormatSmbcBank: {
    en: "SMBC Bank (Income/Expense Statement)",
    ja: "三井住友銀行（入出金明細）",
  },
  importFormatSbiBank: {
    en: "SBI Bank (Income/Expense Statement)",
    ja: "SBI銀行（入出金明細）",
  },
  importSelectCard: { en: "Credit card account", ja: "クレジットカード口座" },
  importSelectBankAccount: { en: "Bank account", ja: "銀行口座" },
  importExpenseAccount: { en: "Expense account", ja: "費用科目" },
  importIncomeAccount: { en: "Income account", ja: "収益科目" },
  importDirectionWithdrawal: { en: "Withdrawal", ja: "出金" },
  importDirectionDeposit: { en: "Deposit", ja: "入金" },
  importNoBankAccounts: {
    en: "No asset accounts found. Create one in Settings first.",
    ja: "資産口座がありません。先に設定で作成してください。",
  },
  importRowTypeExpense: { en: "Expense", ja: "費用" },
  importRowTypeLiability: { en: "Debt payment", ja: "負債返済" },
  importRowTypeTransfer: { en: "Transfer", ja: "振替" },
  importLiabilityAccount: { en: "Liability account", ja: "負債口座" },
  importDuplicateWarning: { en: "Possible duplicate", ja: "重複の可能性" },
  importApplyToAll: { en: "Apply to all matching", ja: "同じ店舗に適用" },
  importConfirmButton: { en: "Import", ja: "インポート" },
  importSuccess: { en: "Import complete", ja: "インポートが完了しました" },
  importDuplicateModalTitle: {
    en: "Duplicate Transactions",
    ja: "重複取引の確認",
  },
  importSkip: { en: "Skip", ja: "スキップ" },
  importImportAnyway: { en: "Import anyway", ja: "インポートする" },
  creditCardImportReminder: {
    en: "Credit card statement import due",
    ja: "クレジットカード明細のインポートをしてください",
  },
  importTransactionCount: { en: "transactions found", ja: "件検出" },
  importStoreCol: { en: "Store / Description", ja: "利用店舗" },
  importDateCol: { en: "Date", ja: "利用日" },
  importAmountCol: { en: "Amount", ja: "金額" },
  importPaymentMonthCol: { en: "Billing month", ja: "支払月" },
  importNoCardAccounts: {
    en: "No credit card accounts found. Create one in Settings first.",
    ja: "クレジットカード口座がありません。先に設定で作成してください。",
  },
  importReviewTitle: { en: "Review Transactions", ja: "取引を確認" },
  importDuplicateTitle: { en: "Duplicate?", ja: "重複？" },

  // BudgetFilterModal
  filterEditTitle: { en: "Edit Filter", ja: "フィルターを編集" },
  filterCreateTitle: { en: "Create New Filter", ja: "新規フィルターを作成" },
  filterReadOnlyAlert: {
    en: "This filter cannot be edited because it has been used",
    ja: "このフィルターは使用済みのため編集できません",
  },
  filterNameLabel: { en: "Filter Name", ja: "フィルター名" },
  filterStepsTitle: { en: "Steps", ja: "ステップ" },
  filterStepLabel: { en: "Step", ja: "ステップ" },
  stepTypeFixed: { en: "Fixed Amount", ja: "固定金額" },
  stepTypeCapped: { en: "Capped Distribution", ja: "上限割合分配" },
  stepTypeRemainder: { en: "Ratio Distribution", ja: "割合分配" },
  filterSelectCategoryPlaceholder: {
    en: "Select category",
    ja: "カテゴリを選択",
  },
  filterCappedTotalLabel: { en: "Cap total", ja: "上限合計" },
  filterRemainderTotalLabel: { en: "Total", ja: "合計" },
  filterAddCategory: { en: "Add Category", ja: "カテゴリを追加" },
  filterAddStep: { en: "Add Step", ja: "ステップを追加" },
  filterNameRequired: { en: "Name is required", ja: "名前を入力してください" },
  filterStepsRequired: {
    en: "Add at least one step",
    ja: "ステップを1つ以上追加してください",
  },
  filterRemainderMustBeLast: {
    en: "Ratio Distribution step must be placed last",
    ja: "割合分配ステップは最後に配置してください",
  },
  filterRemainderOnlyOne: {
    en: "Only one Ratio Distribution step is allowed",
    ja: "割合分配ステップは1つまでです",
  },
  filterRemainderTotalMustBe100: {
    en: "Ratio total must be 100%",
    ja: "割合分配の合計は100%にしてください",
  },
  filterSelectCategory: {
    en: "Please select a budget category",
    ja: "予算カテゴリを選択してください",
  },
  filterCopySuffix: { en: " (Copy)", ja: " (コピー)" },
  close: { en: "Close", ja: "閉じる" },
  saveFailed: { en: "Failed to save", ja: "保存に失敗しました" },
  entrySaved: { en: "Entry saved", ja: "仕訳を保存しました" },

  // SimpleEntryForm (income filter)
  unknownCategoryPrefix: { en: "Category #", ja: "カテゴリ #" },
  applyBudgetFilterLabel: {
    en: "Distribute budget as regular income",
    ja: "定期収入として予算を振り分ける",
  },
  budgetFilterTitle: {
    en: "Budget Distribution Filter",
    ja: "予算振分フィルター",
  },
  filterSelectPlaceholder: { en: "Select a filter", ja: "フィルターを選択" },

  // InputPage
  filterReapplyTitle: { en: "Re-applied this month", ja: "同月の再適用" },
  filterReapplyMessage: {
    en: "The same filter has already been applied this month. Totals have been merged and recalculated.",
    ja: "今月すでに同じフィルターが適用されています。合算して再計算しました。",
  },

  // SettingsPage
  languageLabel: { en: "Language / 言語", ja: "Language / 言語" },
  manageBudget: { en: "Manage →", ja: "管理する →" },
  budgetFilterManagement: {
    en: "budget filter management",
    ja: "予算振分フィルターの管理",
  },
  budgetSetupDesc: {
    en: "Set up budget categories and distribution filters.",
    ja: "予算カテゴリーと振分フィルターを設定します。",
  },

  // BudgetSettingsPage
  filterCopied: { en: "Filter copied", ja: "フィルターをコピーしました" },
  copyFailed: { en: "Failed to copy", ja: "コピーに失敗しました" },
  updateFailed: { en: "Failed to update", ja: "更新に失敗しました" },
  deleteFilter: { en: "Delete Filter", ja: "フィルターを削除" },
  filterDeleteConfirm: {
    en: "Are you sure you want to delete this filter?",
    ja: "このフィルターを削除しますか？",
  },
  deleted: { en: "Deleted", ja: "削除しました" },
  deleteFailed: { en: "Failed to delete", ja: "削除に失敗しました" },
  backToSettings: { en: "← Settings", ja: "← 設定" },
  createFilterBtn: { en: "+ Create New Filter", ja: "+ 新規フィルターを作成" },
  noFilters: {
    en: 'No filters found. Click "+ Create New Filter" to add one.',
    ja: "フィルターがありません。「新規フィルターを作成」から追加してください。",
  },
  thName: { en: "Name", ja: "名前" },
  thStatus: { en: "Status", ja: "状態" },
  thActions: { en: "Actions", ja: "操作" },
  badgeUsed: { en: "Used", ja: "使用済" },
  badgeUnused: { en: "Unused", ja: "未使用" },
  badgeActive: { en: "Active", ja: "アクティブ" },
  badgeInactive: { en: "Inactive", ja: "非アクティブ" },
  copyAndEdit: { en: "Copy & Edit", ja: "コピー＆編集" },
  activateFilter: { en: "Activate", ja: "アクティブにする" },
  deactivateFilter: { en: "Deactivate", ja: "非アクティブ" },
  ok: { en: "OK", ja: "OK" },
  overBudgetWarningTitle: {
    en: "Budget Allocation Exceeds 100%",
    ja: "予算配分が100%を超えています",
  },
  overBudgetWarningMsg: {
    en: "Total budget distribution exceeds 100%. Please adjust the percentages before saving.",
    ja: "予算配分の合計が100%を超えています。保存前に配分を調整してください。",
  },
  underBudgetWarningTitle: {
    en: "Budget Allocation Below 100%",
    ja: "予算配分が100%未満です",
  },
  underBudgetWarningMsg: {
    en: "Total budget distribution is below 100%. The remaining amount will not be tracked in any budget category. Continue anyway?",
    ja: "予算配分の合計が100%未満です。残りの金額はどの予算カテゴリにも記録されません。このまま続けますか？",
  },
  simpleConvertWarningTitle: {
    en: "Cannot Convert to Simple Entry",
    ja: "シンプル入力に変換できません",
  },
  simpleConvertTypeMismatchMsg: {
    en: "This entry uses account types that cannot be represented in simple entry mode.",
    ja: "この仕訳の勘定科目の組み合わせはシンプル入力では表現できません。",
  },
  simpleConvertMultilineSourceMsg: {
    en: "This entry was originally created as a multi-line entry and cannot be converted to simple entry mode.",
    ja: "この仕訳は複合仕訳として作成されたため、シンプル入力に変換できません。",
  },

  // Budget adjustment — assignable money
  assignableMoneyLabel: {
    en: "Assignable (Cash & Bank)",
    ja: "予算可能額（現金・銀行）",
  },
  assignableMoneyTodayLabel: {
    en: "As of today",
    ja: "本日時点",
  },
  assignableMoneyTotalLabel: {
    en: "Incl. future",
    ja: "将来入金を含む",
  },
  assignableMoneyAssetsLabel: {
    en: "assets",
    ja: "資産",
  },
  assignableMoneyCommittedLabel: {
    en: "committed",
    ja: "割当済",
  },

  // Budget type (formerly budget category)
  budgetGroupLabel: { en: "Budget Group", ja: "予算グループ" },
  budgetGroupDaily: { en: "Daily Expenses", ja: "日常支出" },
  budgetGroupSavings: { en: "Savings", ja: "貯蓄" },
  infiniteRolloverLabel: { en: "Infinite rollover", ja: "無期限繰り越し" },
  rolloverMonthsColumn: { en: "Rollover", ja: "繰り越し期間" },
  budgetIncludingSavings: { en: "Budget incl. Savings", ja: "貯蓄込み予算" },
  goalBalanceLabel: { en: "Goal Balance", ja: "目標残高" },
  goalBalanceDesc: {
    en: "Optional savings or spending target for this category",
    ja: "このカテゴリの貯蓄・支出目標（任意）",
  },
  budgetBalanceCapLabel: { en: "Balance Cap", ja: "予算上限" },
  budgetBalanceCapDesc: {
    en: "When the balance exceeds this amount, the excess moves to the selected budget.",
    ja: "残高がこの金額を超えたら、超過分を指定した予算へ移します。",
  },
  budgetOverflowTargetLabel: {
    en: "Excess Budget Target",
    ja: "超過分の割り当て先",
  },
  budgetOverflowTargetPlaceholder: {
    en: "Keep excess here",
    ja: "超過分を移さない",
  },
  goal: { en: "Goal", ja: "目標" },
  goalReachIn: {
    en: "At this rate, goal in ~{months} months",
    ja: "このペースで目標まで約{months}ヶ月",
  },
  goalReachBy: { en: "by {date}", ja: "{date}頃" },
  goalAlreadyReached: { en: "Goal reached!", ja: "目標達成！" },
  optional: { en: "Optional", ja: "任意" },

  // Danger Zone (SettingsPage)
  dangerZoneTitle: { en: "Danger Zone", ja: "危険な操作" },
  dangerZoneDesc: {
    en: "These actions are permanent and cannot be undone. Proceed with caution.",
    ja: "これらの操作は元に戻せません。慎重に実行してください。",
  },
  dangerAdminApiNoticeTitle: {
    en: "Admin API protection",
    ja: "管理 API の保護",
  },
  dangerAdminApiNoticeBody: {
    en: "These actions call /api/admin endpoints. This app does not include built-in authentication, so protect the site with Cloudflare Zero Trust, a VPN, Tailscale, or an authenticated reverse proxy. If these operations are not needed, set DISABLE_ADMIN_API=true in the Worker environment.",
    ja: "これらの操作は /api/admin エンドポイントを呼び出します。このアプリ本体には認証機能がないため、Cloudflare Zero Trust、VPN、Tailscale、認証付きリバースプロキシなどでサイトを保護してください。これらの操作が不要な場合は、Worker の環境変数に DISABLE_ADMIN_API=true を設定してください。",
  },
  dangerEraseMonthLedger: {
    en: "Erase this month's ledger & budget input",
    ja: "今月の仕訳・予算入力を消去",
  },
  dangerEraseMonthLedgerDesc: {
    en: "Deletes all journal entries and budget data (allocations, adjustments) for the current month.",
    ja: "今月の仕訳・予算配分・予算調整をすべて削除します。",
  },
  dangerEraseYearLedger: {
    en: "Erase this year's ledger & budget input",
    ja: "今年の仕訳・予算入力を消去",
  },
  dangerEraseYearLedgerDesc: {
    en: "Deletes all journal entries and budget data for the current year.",
    ja: "今年の仕訳・予算配分・予算調整をすべて削除します。",
  },
  dangerEraseAllLedger: {
    en: "Erase all ledger & budget input",
    ja: "すべての仕訳・予算入力を消去",
  },
  dangerEraseAllLedgerDesc: {
    en: "Deletes all journal entries, budget allocations and adjustment logs across all time.",
    ja: "全期間の仕訳・予算配分・予算調整をすべて削除します。",
  },
  dangerEraseAllAccounts: {
    en: "Erase all accounts",
    ja: "すべての勘定科目を消去",
  },
  dangerEraseAllAccountsDesc: {
    en: "Deletes all accounts and their journal entries (this will also clear the ledger).",
    ja: "すべての勘定科目と関連する仕訳を削除します（帳簿も消去されます）。",
  },
  dangerEraseAllBudgetCategories: {
    en: "Erase all budget categories",
    ja: "すべての予算カテゴリを消去",
  },
  dangerEraseAllBudgetCategoriesDesc: {
    en: "Deletes all budget categories, their allocations and adjustment logs.",
    ja: "すべての予算カテゴリ・配分・調整履歴を削除します。",
  },
  dangerEraseAllData: {
    en: "Erase all data",
    ja: "すべてのデータを消去",
  },
  dangerEraseAllDataDesc: {
    en: "Deletes everything: ledger, accounts, budget categories, filters, and credentials. The app will be reset to a blank state.",
    ja: "仕訳・勘定科目・予算カテゴリ・フィルター・認証情報をすべて削除します。アプリが初期状態にリセットされます。",
  },
  dangerConfirm1Title: { en: "Are you sure?", ja: "本当に実行しますか？" },
  dangerConfirm1Body: {
    en: "This will permanently delete the following data:",
    ja: "次のデータが完全に削除されます：",
  },
  dangerConfirm2Title: {
    en: "Final confirmation",
    ja: "最終確認",
  },
  dangerConfirm2Body: {
    en: "This action is IRREVERSIBLE. There is no undo. All deleted data will be lost forever.",
    ja: "この操作は取り消せません。削除されたデータは永久に失われます。",
  },
  dangerProceedBtn: { en: "Proceed →", ja: "次へ →" },
  dangerConfirmFinalBtn: {
    en: "Yes, delete permanently",
    ja: "はい、完全に削除する",
  },
  dangerSuccessMsg: {
    en: "Data erased successfully",
    ja: "データを消去しました",
  },
  dangerErrorMsg: {
    en: "Failed to erase data",
    ja: "データの消去に失敗しました",
  },

  // Input page tabs (additional)
  tabCsvImport: { en: "CSV Import", ja: "CSVインポート" },
  tabBulkExpense: { en: "Bulk Expense", ja: "支出一括入力" },

  // Bulk expense tab
  bulkExpensePaymentAccount: {
    en: "Payment account (CR)",
    ja: "支払い口座（貸方）",
  },
  bulkExpenseAddExpenseRow: { en: "+ Expense row", ja: "+ 支出行を追加" },
  bulkExpenseCopyLastDate: {
    en: "Copy date from last row",
    ja: "最終行の日付を複製",
  },
  bulkExpenseAddDiscountRow: {
    en: "+ Discount/GC row",
    ja: "+ 割引・GC行を追加",
  },
  bulkExpenseOrderDate: { en: "Order date", ja: "注文日" },
  bulkExpenseItemName: { en: "Item name", ja: "商品名" },
  bulkExpenseQty: { en: "Qty", ja: "個数" },
  bulkExpensePrice: { en: "Price (¥)", ja: "価格（円）" },
  bulkExpenseExpenseAccount: { en: "Expense account", ja: "費用科目" },
  bulkExpenseDiscountDate: { en: "Use date", ja: "使用日" },
  bulkExpenseDiscountType: {
    en: "Type (GC/points/etc.)",
    ja: "種別（GC・ポイント等）",
  },
  bulkExpenseDiscountAmount: { en: "Amount (¥)", ja: "金額（円）" },
  bulkExpenseIncomeAccount: { en: "Income account", ja: "収益科目" },
  bulkExpenseBudgetCategory: {
    en: "Budget category (opt.)",
    ja: "振分先予算（任意）",
  },
  bulkExpenseCalcTotal: { en: "Calculated total", ja: "試算合計" },
  bulkExpenseAmazonBilling: {
    en: "Amazon billing amount",
    ja: "Amazonの請求額",
  },
  bulkExpenseBillingLabel: { en: "Label (optional)", ja: "ラベル（任意）" },
  bulkExpenseAddBillingRow: { en: "+ Add row", ja: "+ 行を追加" },
  bulkExpenseBillingTotal: { en: "Billing total", ja: "請求合計" },
  bulkExpenseDiff: { en: "Difference", ja: "差額" },
  bulkExpensePostAll: { en: "Post all to ledger", ja: "まとめて記入" },
  bulkExpenseNoPaymentAccount: {
    en: "Select a payment account first",
    ja: "支払い口座を先に選択してください",
  },
  bulkExpensePosted: { en: "Posted to ledger", ja: "帳簿に記入しました" },
  bulkExpenseRowTypeExpense: { en: "Expense", ja: "支出" },
  bulkExpenseRowTypeDiscount: { en: "Discount/GC", ja: "割引・GC" },
  bulkExpenseColType: { en: "Type", ja: "種別" },
  bulkExpenseColDate: { en: "Date", ja: "日付" },
  bulkExpenseColName: { en: "Name", ja: "名称" },
  bulkExpenseColQty: { en: "Qty", ja: "個数" },
  bulkExpenseColAmount: { en: "Amount (¥)", ja: "金額(¥)" },
  bulkExpenseColAccount: { en: "Account", ja: "勘定科目" },
  bulkExpenseColBudget: { en: "Budget category", ja: "振分先予算" },
  bulkExpenseDefaultExpenseDesc: { en: "Amazon purchase", ja: "Amazon購入" },
  bulkExpenseDefaultDiscountDesc: {
    en: "Discount/GC/Points",
    ja: "割引・ギフトカード等",
  },
  bulkExpenseNoRows: { en: "No rows to post", ja: "記入する行がありません" },
  bulkExpenseSkippedRows: {
    en: "{n} row(s) have no account selected and will not be recorded. Continue?",
    ja: "勘定科目が未選択の行が {n} 件あるため、記録されません。続けてよろしいですか？",
  },
  bulkExpenseSkippedTitle: {
    en: "Some rows will be skipped",
    ja: "一部の行がスキップされます",
  },
  bulkExpenseExpensePlaceholder: { en: "Expense account", ja: "費用科目" },
  bulkExpenseIncomePlaceholder: { en: "Income account", ja: "収益科目" },
  bulkExpenseBudgetPlaceholder: { en: "Optional", ja: "任意" },
  groupExpenseAccounts: { en: "Expense accounts", ja: "費用科目" },
  groupIncomeAccounts: { en: "Income accounts", ja: "収益科目" },
  groupLiabilityAccounts: { en: "Liability accounts", ja: "負債科目" },
  groupAssetAccounts: { en: "Asset accounts", ja: "資産科目" },
  importGroupAssetTransferAccounts: {
    en: "Asset accounts (transfer source)",
    ja: "資産科目（振替元）",
  },

  // Store mappings (SettingsPage + CSV import)
  storeMappingsTitle: {
    en: "Store → Account Mappings",
    ja: "店舗・勘定科目マッピング",
  },
  storeMappingsDesc: {
    en: "Remembered account assignments from CSV import. Click × to remove.",
    ja: "CSVインポートで記憶した勘定科目の割り当てです。×で削除できます。",
  },
  storeMappingsNoItems: {
    en: "No mappings yet.",
    ja: "マッピングがありません。",
  },
  storeMappingSaved: { en: "Mapping saved", ja: "マッピングを保存しました" },
  storeMappingDeleted: {
    en: "Mapping deleted",
    ja: "マッピングを削除しました",
  },
  storeMappingOverwriteTitle: {
    en: "Overwrite mapping?",
    ja: "マッピングを上書きしますか？",
  },
  storeMappingOverwriteMsg: {
    en: 'Store "{store}" already has an account mapping ({existing}). Overwrite with {new}?',
    ja: "「{store}」にはすでにマッピング（{existing}）があります。{new}に上書きしますか？",
  },
  storeMappingOverwrite: { en: "Overwrite", ja: "上書き" },
  importAmazonHint: {
    en: "Amazon transaction detected. Check your order history at:",
    ja: "Amazon取引が検出されました。注文履歴はこちら：",
  },
  importAmazonBulkBadge: {
    en: "→ Bulk Expense",
    ja: "→支出一括入力",
  },
  importAmazonSwitched: {
    en: "Amazon transaction(s) moved to Bulk Expense tab",
    ja: "Amazon取引を支出一括入力タブに転送しました",
  },
  importAmazonCount: {
    en: "{count} Amazon order(s) → Bulk Expense",
    ja: "{count}件のAmazon注文 → 支出一括入力",
  },
  importSalaryCount: {
    en: "{count} salary row(s) -> Simple",
    ja: "{count}\u4ef6\u306e\u7d66\u4e0e\u884c -> \u30b7\u30f3\u30d7\u30eb",
  },
  importSalarySwitched: {
    en: "Salary row(s) moved to Simple input",
    ja: "\u7d66\u4e0e\u884c\u3092\u30b7\u30f3\u30d7\u30eb\u5165\u529b\u306b\u79fb\u3057\u307e\u3057\u305f",
  },
  importSalaryAndAmazonSwitched: {
    en: "Salary row(s) moved to Simple input and Amazon row(s) to Bulk Expense",
    ja: "\u7d66\u4e0e\u884c\u3092\u30b7\u30f3\u30d7\u30eb\u5165\u529b\u3078\u3001Amazon\u884c\u3092\u4e00\u62ec\u5165\u529b\u3078\u79fb\u3057\u307e\u3057\u305f",
  },
  importEmptyRowsWarning: {
    en: "{count} row(s) have no account selected and will not be imported. Continue?",
    ja: "{count}件の行に勘定科目が未選択のため、インポートされません。続行しますか？",
  },
  importEmptyRowsWarningTitle: {
    en: "Rows without account",
    ja: "科目未選択の行があります",
  },
  importContinue: { en: "Continue", ja: "続行" },

  // Journal delete confirmation
  deleteJournalConfirm: { en: "Delete Entry", ja: "仕訳を削除" },
  deleteJournalConfirmMsg: {
    en: "Are you sure you want to delete this entry? This cannot be undone.",
    ja: "この仕訳を削除しますか？この操作は元に戻せません。",
  },
  suppressDeleteWarning5min: {
    en: "Don't show this warning for 5 minutes",
    ja: "5分間この警告を表示しない",
  },
  // Depreciation
  includeInAllocatableLabel: {
    en: "Include as budget allocation source",
    ja: "予算割り当て元に含める",
  },
  includeInAllocatableHint: {
    en: "Only checked cash/bank accounts are counted as allocatable money.",
    ja: "ONの現金・預金科目だけを予算可能額に含めます。",
  },
  isDepreciableLabel: {
    en: "Depreciable asset (備品等)",
    ja: "減価償却対象（備品等）",
  },
  isDepreciableHint: {
    en: "Mark this asset account as a depreciable item",
    ja: "この資産科目を減価償却の対象に設定します",
  },
  depreciationSettingsTitle: {
    en: "Depreciation Settings",
    ja: "減価償却の設定",
  },
  depreciationSettingsHint: {
    en: "Select the expense account used to record monthly depreciation (減価償却費)",
    ja: "毎月の減価償却費を記録するために使用する費用科目を選択してください",
  },
  depreciationAccountNone: {
    en: "No account selected",
    ja: "科目を選択",
  },
  businessOwnerSettingsTitle: {
    en: "Business Owner Advance Settings",
    ja: "事業主用立替設定",
  },
  businessOwnerSettingsHint: {
    en: "Configure accounts for recording business expense advances as a sole proprietor.",
    ja: "個人事業主として事業用経費を立て替えた場合の科目を設定します。",
  },
  isBusinessOwner: {
    en: "I am a sole proprietor (個人事業主)",
    ja: "私は事業主です",
  },
  businessAdvanceAccountLabel: {
    en: "Business advance account (事業立替金科目)",
    ja: "事業立替金科目",
  },
  businessAdvanceAccountDesc: {
    en: "Asset account that records amounts owed to you by the business.",
    ja: "事業が負債として計上する立替金の資産科目。",
  },
  businessLossAccountLabel: {
    en: "Loss disposal account",
    ja: "損失として破棄する場合の科目",
  },
  businessLossAccountDesc: {
    en: "Expense account used when writing off an advance as irrecoverable.",
    ja: "回収不能と判断した立替金を損失として破棄する際に使う費用科目。",
  },
  businessAdvanceBudgetCategoryLabel: {
    en: "Budget source for advances",
    ja: "事業立替金の予算元",
  },
  businessAdvanceBudgetCategoryDesc: {
    en: "Budget category from which the business portion is deducted.",
    ja: "事業用割合分を予算から差し引く予算カテゴリー。",
  },
  transactionTypeBusinessAdvance: {
    en: "Business Advance",
    ja: "事業立替",
  },
  businessRatioLabel: {
    en: "Business use ratio",
    ja: "事業用割合",
  },
  businessRatioDesc: {
    en: "Portion of this expense that is a business cost.",
    ja: "この支出のうち事業用経費にあたる割合。",
  },
  businessAdvanceSplitBusiness: { en: "Business:", ja: "事業用:" },
  businessAdvanceSplitPersonal: { en: "Personal:", ja: "個人用:" },
  personalPortionLabel: { en: "Personal portion", ja: "個人用分" },
  tabBusinessAdvanceProcess: {
    en: "Advance Processing",
    ja: "事業立替金処理",
  },
  businessAdvanceModeTransfer: {
    en: "Transfer (reimburse)",
    ja: "振替（入金）",
  },
  businessAdvanceModeDispose: {
    en: "Dispose as loss",
    ja: "損失として破棄",
  },
  businessAdvanceTransferDesc: {
    en: "Business advance reimbursement",
    ja: "事業立替金回収",
  },
  businessAdvanceDisposeDesc: {
    en: "Write off business advance",
    ja: "事業立替金損失処理",
  },
  businessAdvanceTransferToLabel: {
    en: "Transfer to account",
    ja: "振替先科目",
  },
  businessAdvanceAccountNotSet: {
    en: "Business advance account is not configured. Please set it in Settings.",
    ja: "事業立替金科目が設定されていません。設定ページで設定してください。",
  },
  businessAdvanceBalanceHistory: {
    en: "Balance History",
    ja: "残高履歴",
  },
  changeColHeader: { en: "Change", ja: "増減" },
  goToSettings: { en: "Go to Settings", ja: "設定ページへ" },
  currentBalance: { en: "current balance", ja: "現在残高" },
  depreciationLabel: { en: "Depreciation", ja: "減価償却" },
  depreciationAssetAccountLabel: {
    en: "Asset account (備品等)",
    ja: "備品科目",
  },
  depreciationExpenseAccountLabel: {
    en: "Depreciation expense account",
    ja: "減価償却費科目",
  },
  depreciationByMonths: { en: "By period", ja: "期間入力" },
  depreciationByMonthlyAmount: { en: "By monthly amount", ja: "月額入力" },
  depreciationMonthsLabel: {
    en: "Depreciation period (months)",
    ja: "償却月数",
  },
  depreciationMonthlyAmountLabel: {
    en: "Monthly depreciation amount",
    ja: "月額償却額",
  },
  depreciationPreview: { en: "Approx", ja: "概算" },
  depreciationMonthUnit: { en: " months", ja: "ヶ月" },
  depreciationCreated: {
    en: "Depreciation schedule created",
    ja: "減価償却スケジュールを作成しました",
  },
  depreciationEntryEditWarning: {
    en: "Editing an individual depreciation entry can break the schedule calculation. Update the source asset entry when possible.",
    ja: "個別の減価償却仕訳を直接編集すると、スケジュール計算が崩れる可能性があります。可能であれば元の資産購入仕訳から編集してください。",
  },
  depreciableAssetsTotal: {
    en: "Depreciable assets total (net book value)",
    ja: "減価償却対象資産合計（帳簿価額）",
  },
  depreciationReportTitle: {
    en: "Depreciation",
    ja: "減価償却",
  },
  depreciationTotal: {
    en: "Total depreciation",
    ja: "減価償却費合計",
  },
  depreciationNone: {
    en: "No depreciation recorded for this period.",
    ja: "この期間の減価償却費はありません。",
  },
  depreciationBudgetPressure: {
    en: "Budget pressure (% of total expenses)",
    ja: "予算圧迫率（支出合計に占める割合）",
  },
  depreciationBudgetPressureNoExpense: {
    en: "No expenses recorded for this year.",
    ja: "この年の支出データがありません。",
  },

  // P&L budget consistency check
  budgetConsistencyTitle: {
    en: "Budget Consistency Check",
    ja: "予算整合性チェック",
  },
  budgetConsistencyClear: {
    en: "All {n} transactions match budget allocations.",
    ja: "全{n}件の取引が予算配分と一致しています。",
  },
  budgetConsistencyIssues: {
    en: "{n} suspicious transaction(s) detected",
    ja: "{n}件の疑わしい取引を検出",
  },
  budgetConsistencyChecked: {
    en: "{n} checked",
    ja: "{n}件チェック済み",
  },
  budgetCheckIssue: { en: "Issue", ja: "問題" },
  budgetCheckAllocated: { en: "Allocated", ja: "配分" },
  suspiciousExpenseNoAlloc: {
    en: "Expense not tracked in any budget category",
    ja: "費用が予算カテゴリに配分されていません",
  },
  suspiciousExpenseMismatch: {
    en: "Expense vs allocation gap: actual ¥{actual} / allocated ¥{allocated}",
    ja: "費用額と予算配分の差異: 実際¥{actual} / 配分¥{allocated}",
  },
  suspiciousIncomeMismatch: {
    en: "Income vs distribution gap: actual ¥{actual} / distributed ¥{distributed}",
    ja: "収入額と予算分配の差異: 実際¥{actual} / 分配¥{distributed}",
  },
  // Trial balance page (/fs/tt)
  tabTrialBalance: { en: "Trial Balance", ja: "試算表" },
  tabTrialBalanceDesc: {
    en: "Reconcile & verify account balances",
    ja: "残高照合・差異確認",
  },
  // Loan management page (/fs/db)
  tabLoanMgmt: { en: "Loan Mgmt", ja: "ローン管理" },
  tabLoanMgmtDesc: { en: "Manage loans & borrowings", ja: "貸し借りを管理" },
  sectionShortTermLending: { en: "Short-term Lending", ja: "短期貸付" },
  sectionLongTermLending: { en: "Long-term Lending", ja: "長期貸付" },
  sectionShortTermLoan: { en: "Short-term Borrowing", ja: "短期借入" },
  sectionLongTermLoan: { en: "Long-term Borrowing", ja: "長期借入" },
  noLoanAccounts: {
    en: "No accounts in this category.",
    ja: "この区分の科目はありません。",
  },
  loanNetChange: { en: "Amount", ja: "金額" },
  loanSettlementEntry: { en: "Repayment / Collection", ja: "返済・回収" },
  loanOpeningEntry: { en: "New Loan / Borrow", ja: "新規貸付・借入" },
  multiLineLoanOpeningNotice: {
    en: "This entry will be registered as a new short-term loan/borrow opening event.",
    ja: "この仕訳は短期貸付・借入の新規発生として登録されます。",
  },
  loanAccountBalance: { en: "Outstanding Balance", ja: "残高" },
  loanBalanceHistory: { en: "Balance history", ja: "残高増減履歴" },
  loanHistoryChange: { en: "Change", ja: "増減" },
  loanHistoryBalance: { en: "Balance", ja: "残高" },
  loanCompletedBadge: { en: "Completed", ja: "完了" },
  loanNoEntries: {
    en: "No transaction history for this category.",
    ja: "この区分の取引履歴はありません。",
  },
  loanInputBtn: { en: "Go to Input", ja: "ここから入力" },
  loanForceCompleteBtn: { en: "Force Complete", ja: "強制完了" },
  loanForceUncompleteBtn: { en: "Reopen", ja: "完了解除" },
  loanForceSettleConfirmTitle: {
    en: "Confirm Force Settle",
    ja: "強制精算の確認",
  },
  loanForceSettleConfirmMsg: {
    en: 'Force settle "{desc}"? A reversing entry dated today will be created automatically.',
    ja: "「{desc}」を強制精算します。本日付の相殺仕訳が自動作成されます。",
  },
  loanForceSettleDescPrefix: { en: "Force Settle: ", ja: "強制精算: " },
  loanWriteOffModalTitle: {
    en: "Write Off as Loss",
    ja: "損失計上（強制完了）",
  },
  loanWriteOffDesc: {
    en: 'Write off "{desc}" by recording an expense. An entry dated today will be created automatically.',
    ja: "「{desc}」を費用計上して強制完了します。本日付の仕訳が自動作成されます。",
  },
  loanWriteOffAmountLabel: { en: "Write-off Amount", ja: "計上金額" },
  loanWriteOffExpenseLabel: { en: "Expense Account", ja: "費用科目" },
  loanWriteOffIncomeLabel: { en: "Income Account", ja: "収益科目" },
  loanWriteOffConfirmBtn: { en: "Write Off & Complete", ja: "計上して完了" },
  loanCompletedAccordion: {
    en: "Completed ({count})",
    ja: "完了済み（{count}件）",
  },
  loanSettledPairsAccordion: {
    en: "Settled ({count})",
    ja: "返済済み（{count}件）",
  },
  loanSettledOpeningLabel: { en: "Borrow / Lend", ja: "借入・貸付" },
  loanSettledByLabel: { en: "Repayment / Collection", ja: "返済・回収" },
  loanDetailBtn: { en: "Repayment Plan", ja: "返済計画" },

  // Long-term loan detail page (/fs/db/long-term-loan/:id, /fs/db/long-term-lend/:id)
  loanDetailTitle: { en: "Repayment / Collection Plan", ja: "返済・回収計画" },
  loanDetailPlanHeader: { en: "Plan Settings", ja: "計画設定" },
  loanDetailTotalPrincipal: { en: "Total Principal", ja: "元本総額" },
  loanDetailAnnualRate: { en: "Annual Interest Rate (%)", ja: "年利（%）" },
  loanDetailMonthlyPayment: {
    en: "Fixed Monthly Payment",
    ja: "月額固定返済額",
  },
  loanDetailStartMonth: { en: "Start Month", ja: "開始月" },
  loanDetailNote: { en: "Note", ja: "メモ" },
  loanDetailSavePlan: { en: "Save Settings", ja: "設定を保存" },
  loanDetailPlanRows: { en: "Repayment Schedule", ja: "返済スケジュール" },
  loanDetailNoPlan: {
    en: "No repayment plan yet. Create one below.",
    ja: "まだ返済計画がありません。以下から作成してください。",
  },
  loanDetailMonth: { en: "Month", ja: "月" },
  loanDetailPrincipal: { en: "Principal", ja: "元本" },
  loanDetailInterest: { en: "Interest", ja: "利子" },
  loanDetailRowNote: { en: "Note", ja: "メモ" },
  loanDetailAddRow: { en: "Add Row", ja: "行を追加" },
  loanDetailAutoFill: { en: "Auto-fill", ja: "一括入力" },
  loanDetailAutoFillDesc: {
    en: "Generate a repayment schedule from the plan settings above.",
    ja: "上記の計画設定をもとに返済スケジュールを生成します。",
  },
  loanDetailPaymentMethod: { en: "Payment method", ja: "計算方法" },
  loanDetailEqualPrincipal: {
    en: "Equal principal (元金均等)",
    ja: "元金均等払い",
  },
  loanDetailEqualPayment: {
    en: "Equal payment (元利均等)",
    ja: "元利均等払い",
  },
  loanDetailAutoFillMonths: { en: "Number of months", ja: "分割月数" },
  loanDetailAutoFillPayment: { en: "Monthly payment", ja: "月額返済額" },
  loanDetailAutoFillCalcPayment: { en: "Calculated", ja: "試算" },
  loanDetailAutoFillEstMonths: { en: "Est. months", ja: "試算月数" },
  loanDetailAutoFillConfirm: { en: "Generate", ja: "生成" },
  loanDetailDeleteRow: { en: "Delete", ja: "削除" },
  loanDetailSaveRows: { en: "Save Schedule", ja: "スケジュールを保存" },
  loanDetailComparison: { en: "Plan vs. Actual", ja: "計画 vs. 実績" },
  loanDetailCompPlanned: { en: "Planned", ja: "計画" },
  loanDetailCompActual: { en: "Actual", ja: "実績" },
  loanDetailCompDiff: { en: "Diff", ja: "差異" },
  loanDetailCompPrincipal: { en: "Principal", ja: "元本" },
  loanDetailCompInterest: { en: "Interest", ja: "利子" },
  loanDetailCompTotal: { en: "Total", ja: "合計" },
  loanDetailCompNoData: {
    en: "No comparison data yet.",
    ja: "照合データがありません。",
  },
  loanDetailSaved: { en: "Saved", ja: "保存しました" },
  loanDetailSaveError: { en: "Save failed", ja: "保存に失敗しました" },
  loanDetailUnsavedWarning: {
    en: "You have unsaved changes",
    ja: "未保存の変更があります",
  },
  loanDetailCompJournalEntries: { en: "Entries", ja: "仕訳" },

  // Long-term loan detail — transaction history & interest modal
  loanHistoryTitle: { en: "Transaction History", ja: "残高増減履歴" },
  loanHistoryDate: { en: "Date", ja: "日付" },
  loanHistoryDesc: { en: "Description", ja: "摘要" },
  loanHistoryPrincipal: { en: "Principal Change", ja: "元本増減" },
  loanHistoryFee: { en: "Fee / Interest", ja: "手数料・利子" },
  loanHistoryExpectedFee: { en: "Expected Interest", ja: "試算利子" },
  loanHistoryRate: { en: "Implied Rate (ann.)", ja: "換算年利" },
  loanImpliedRate: { en: "Avg. implied rate", ja: "推計平均年利" },
  loanAddInterestBtn: { en: "Add Interest Entry", ja: "利子仕訳を追加" },
  loanInterestModalTitle: { en: "Add Interest Entry", ja: "利子仕訳を追加" },
  loanInterestAmountLabel: { en: "Interest Amount", ja: "利子金額" },
  loanInterestAccount: {
    en: "Interest Account (income/expense)",
    ja: "利子科目（収益/費用）",
  },
  loanInterestPaymentAccount: {
    en: "Settlement Account (cash/bank)",
    ja: "決済口座（現金/預金）",
  },

  svViewDetails: { en: "View Details →", ja: "詳細を見る →" },
  // Savings page (/fs/sv)
  tabSavings: { en: "Savings", ja: "貯蓄" },
  tabSavingsDesc: { en: "Track savings goals", ja: "貯蓄目標を管理" },
  savingsMonthlyContributions: {
    en: "Monthly Contributions (last 12 months)",
    ja: "月次積立額（直近12ヶ月）",
  },
  savingsNoCategories: {
    en: 'No savings categories set up yet. Add a budget category with group "貯蓄" in settings.',
    ja: "貯蓄カテゴリーがまだありません。設定でグループ「貯蓄」の予算カテゴリーを追加してください。",
  },
  savingsShowFuturePrediction: {
    en: "Show future prediction",
    ja: "未来予測を含める",
  },
  savingsPredictedSuffix: { en: " (predicted)", ja: "（予測）" },
  ttSegActualInput: { en: "Enter Actuals", ja: "現在値入力" },
  ttSegDeviation: { en: "Error Verification", ja: "誤差検証" },
  ttSegBudgetCheck: { en: "Budget Check", ja: "予算整合性チェック" },
  ttSegUnknownFunds: { en: "Unknown Funds", ja: "不明金処理" },

  // Actual value input section
  ttActualInputTitle: {
    en: "Enter actual account balances",
    ja: "実際の残高を入力",
  },
  ttActualInputDesc: {
    en: "Enter the real-world balance for each account to check for discrepancies. Accounts left blank will not be checked.",
    ja: "各口座の実際の残高を入力して、帳簿との差異を確認します。入力しない口座はチェック対象外になります。",
  },
  ttActualInputDate: { en: "As of date", ja: "基準日" },
  ttActualInputSubmit: { en: "Save & Compare", ja: "保存して比較へ" },
  ttActualInputSaved: {
    en: "Snapshot saved",
    ja: "現在値を保存しました",
  },
  ttActualInputNoAccounts: {
    en: "No asset or liability accounts found.",
    ja: "資産・負債の科目がありません。",
  },
  ttActualModeGeneral: {
    en: "Assets / Liabilities",
    ja: "資産・一般負債",
  },
  ttActualModeCreditCard: {
    en: "Credit Cards",
    ja: "クレジットカード",
  },
  ttActualGeneralDesc: {
    en: "Enter current balances for assets and non-credit-card liabilities.",
    ja: "資産およびクレジットカード以外の負債の現在値を入力します。",
  },
  ttActualCreditCardDesc: {
    en: "Track credit-card balances by month so confirmed past months remain available for later reconciliation.",
    ja: "クレジットカード利用額を月別に記録し、過去の確定分を後日の照合に残します。",
  },
  ttActualSectionAssets: { en: "Assets", ja: "資産" },
  ttActualSectionLiabilities: { en: "Liabilities", ja: "負債" },
  ttCcNoAccounts: {
    en: "No credit card accounts found.",
    ja: "クレジットカード科目がありません。",
  },
  ttCcAddMonth: {
    en: "Add 3 confirmed months",
    ja: "確定月を3ヶ月追加",
  },
  ttCcShowMoreMonths: {
    en: "Show 3 more months",
    ja: "3ヶ月追加で表示",
  },
  ttCcHiddenMonths: {
    en: "{n} older month(s) hidden",
    ja: "過去{n}ヶ月分を非表示中",
  },
  ttCcPaymentMonth: {
    en: "Month",
    ja: "月",
  },
  ttCcUsageHint: {
    en: "Usage period / payment",
    ja: "利用期間 / 支払日",
  },
  ttCcEntryStatus: {
    en: "Status",
    ja: "状態",
  },
  ttCcWithdrawalAmount: {
    en: "Withdrawal amount",
    ja: "引き落とし金額",
  },
  ttCcStatusOpen: {
    en: "Open",
    ja: "変動中",
  },
  ttCcStatusConfirmed: {
    en: "Confirmed",
    ja: "確定",
  },
  ttCcStatusPaid: {
    en: "Paid",
    ja: "支払済",
  },

  // Credit card breakdown slots
  ccSlotThisMonth: { en: "This month's charges", ja: "今月支払分" }, // unused — label built dynamically in TtPage
  ccSlotLastMonth: { en: "Prior month's charges", ja: "前月支払分" }, // unused — label built dynamically in TtPage
  ccSlotFuture: { en: "Future months", ja: "今月以降" },
  ccSlotRevolving: { en: "Revolving (リボ払い)", ja: "リボ払い" },
  ccSlotCashing: { en: "Cash advance (キャッシング)", ja: "キャッシング" },
  ccSlotTotal: { en: "Subtotal", ja: "小計" },
  ccLastMonthZeroNote: {
    en: "Auto-set to 0 (withdrawal date {day} has passed)",
    ja: "自動で0に設定（引落日{day}日は経過済み）",
  },

  // Deviation comparison section
  ttDeviationTitle: { en: "Book vs Actual Comparison", ja: "簿価との比較" },
  ttDeviationNoSnapshot: {
    en: "No actual balance data yet. Enter actual values first.",
    ja: "現在値データがありません。先に現在値を入力してください。",
  },
  ttDeviationSnapshotDate: { en: "Snapshot date", ja: "基準日" },
  ttDeviationAccount: { en: "Account", ja: "勘定科目" },
  ttDeviationBookValue: { en: "Book value", ja: "簿価" },
  ttDeviationActualValue: { en: "Actual value", ja: "実際の値" },
  ttDeviationDiff: { en: "Deviation", ja: "差異" },
  ttDeviationDuplicateCandidates: {
    en: "{n} matching journal candidate(s)",
    ja: "一致候補の仕訳 {n}件",
  },
  ttDeviationMoreMatches: {
    en: "{n} more candidate(s)",
    ja: "ほか {n}件",
  },
  ttDeviationOutOfScopeBadge: {
    en: "Outside current scope",
    ja: "期間外の残高あり",
  },
  ttDeviationOutOfScopeWarning: {
    en: "Entries outside this month/last month may remain. Outside-scope book {book}, actual {actual}, deviation {diff}.",
    ja: "当月分・先月分の外に残高の可能性があります。期間外の簿価 {book}、実際値 {actual}、差異 {diff}。",
  },
  ttDeviationTotal: { en: "Total deviation", ja: "差異合計" },
  ttDeviationGeneralTotal: {
    en: "Assets / Liabilities deviation",
    ja: "資産・一般負債差異",
  },
  ttDeviationCreditCardTotal: {
    en: "Credit card deviation",
    ja: "クレジットカード差異",
  },
  ttDeviationGrandTotal: {
    en: "Overall deviation",
    ja: "総合差異",
  },
  ttDeviationGeneralSection: {
    en: "Assets / General Liabilities",
    ja: "資産・一般負債",
  },
  ttDeviationCreditCardSection: {
    en: "Credit Cards",
    ja: "クレジットカード",
  },
  ttDeviationNoGeneralEntries: {
    en: "No asset or non-credit-card liability entries in this snapshot.",
    ja: "この試算には資産・一般負債の記録がありません。",
  },
  ttDeviationNoCreditCardEntries: {
    en: "No credit card entries in this snapshot.",
    ja: "この試算にはクレジットカードの記録がありません。",
  },
  ttDeviationHiddenResolvedCcRows: {
    en: "{n} paid reconciled row(s) older than 3 months hidden.",
    ja: "3ヶ月以上前の支払済・差異なし {n}件を非表示中。",
  },
  ttDeviationShowResolvedCcRows: {
    en: "Show hidden rows ({n})",
    ja: "非表示分を表示（{n}件）",
  },
  ttDeviationHideResolvedCcRows: {
    en: "Hide resolved rows",
    ja: "解決済みを非表示",
  },
  ttDeviationOnlyHiddenCreditCardEntries: {
    en: "Only paid reconciled credit-card rows older than 3 months are hidden.",
    ja: "3ヶ月以上前の支払済・差異なしのクレジットカード行のみ非表示です。",
  },
  ttDeviationCreditCardOnlyHint: {
    en: "Only credit-card deviations remain. Review the monthly credit-card table.",
    ja: "現在残っている差異はクレジットカードのみです。月次表を確認してください。",
  },
  ttNoDeviation: {
    en: "No discrepancies found. Books match actuals.",
    ja: "差異なし。帳簿と実際の値が一致しています。",
  },
  ttProcessAsUnknownFunds: {
    en: "Process as Unknown Funds",
    ja: "不明金として処理する",
  },
  ttUnknownFundsJournalPreview: {
    en: "The following journal entries will be recorded:",
    ja: "以下の仕訳を記録します：",
  },
  ttUnknownFundsConfirmMsg: {
    en: "Record these entries to correct the balance discrepancies?",
    ja: "上記の仕訳を記録して残高差異を修正しますか？",
  },
  ttUnknownFundsRecorded: {
    en: "Unknown fund entries recorded",
    ja: "不明金仕訳を記録しました",
  },
  ttDeviationSelectSnapshot: { en: "Select snapshot", ja: "基準日を選択" },

  // Unknown funds processing section
  ttUnknownFundsTitle: {
    en: "Unknown Fund Entries",
    ja: "不明金の仕訳一覧",
  },
  ttUnknownFundsEmpty: {
    en: "No unknown fund entries found.",
    ja: "不明金の仕訳はありません。",
  },
  ttUnknownFundsFixKnown: { en: "Cause found — correct", ja: "原因判明・修正" },
  ttUnknownFundsMiscLoss: {
    en: "Classify as misc. loss/gain",
    ja: "雑損・雑益として処理",
  },
  ttUnknownFundsFixTitle: {
    en: "Correct Unknown Fund Entry",
    ja: "不明金の修正仕訳",
  },
  ttUnknownFundsMiscTitle: {
    en: "Classify as Miscellaneous",
    ja: "雑損・雑益として処理",
  },
  ttUnknownFundsFixConfirm: {
    en: "Record correcting entry and adjust the unknown fund balance?",
    ja: "修正仕訳を記録して不明金残高を調整しますか？",
  },
  ttUnknownFundsMiscConfirm: {
    en: "Record the following entry to clear this unknown fund?",
    ja: "以下の仕訳を記録して不明金を解消しますか？",
  },
  ttUnknownFundsProcessed: {
    en: "Entry processed",
    ja: "不明金を処理しました",
  },
  ttCauseFoundInput: {
    en: "Cause found — enter directly",
    ja: "原因が判明したので、追加で入力する",
  },
  ttBackToDeviation: { en: "Back to Error Verification", ja: "誤差検証に戻る" },
  ttWorksheetTitle: { en: "Adjustment Worksheet", ja: "調整試算表" },
  ttWorksheetNote: {
    en: "Adjustments are saved per reference date in browser storage (not in the database).",
    ja: "調整値は基準日ごとにブラウザに保存されます（データベースには保存されません）。",
  },
  ttWorksheetAddRow: { en: "Add row", ja: "行を追加" },
  ttWorksheetAccount: { en: "Account", ja: "勘定科目" },
  ttWorksheetAmount: { en: "Amount", ja: "金額" },
  ttWorksheetAdjustment: { en: "Adjustment", ja: "調整値" },
  ttWorksheetAdjustedDeviation: {
    en: "Adjusted deviation",
    ja: "調整後の差異",
  },
  ttWorksheetNote2: { en: "Note", ja: "摘要" },
  ttOffsetCcTitle: {
    en: "Billing Offset Entries",
    ja: "請求オフセット適用明細",
  },
  ttOffsetCcOriginalMonth: {
    en: "Original → Offset month",
    ja: "本来→オフセット後の請求月",
  },
  ttDeleteSnapshot: { en: "Delete this snapshot", ja: "この試算を削除する" },
  ttDeleteSnapshotConfirm: {
    en: "Delete this snapshot and all its entries? This cannot be undone.",
    ja: "この試算とすべての記録を削除しますか？この操作は元に戻せません。",
  },
  ttDeleteSnapshotZeroWarning: {
    en: "This snapshot has no discrepancies — it is recommended to keep it as a reconciliation record.",
    ja: "この試算は誤差がありません。照合記録として残しておくことを推奨します。",
  },
  ttDeleteSnapshotDeleted: {
    en: "Snapshot deleted",
    ja: "試算を削除しました",
  },
  ttLastCleanSnapshot: {
    en: "Last verified (no discrepancy)",
    ja: "最終確認（誤差なし）",
  },
  ttMiscReclassWarning: {
    en: "Entries reclassified as misc. loss/gain cannot be reversed outside of double-entry bookkeeping.",
    ja: "雑益・雑損に振り替えたものは複式簿記以外では取り消せません。",
  },

  // System account display names
  sysUnknownFunds: { en: "Unknown Funds", ja: "不明金" },
  sysMiscExpense: { en: "Misc. Loss", ja: "雑損" },
  sysMiscIncome: { en: "Misc. Gain", ja: "雑益" },
  sysSecuritiesGain: { en: "Securities Gain on Sale", ja: "有価証券売却益" },
  sysSecuritiesLoss: { en: "Securities Loss on Sale", ja: "有価証券売却損" },
  sysCryptoGain: { en: "Crypto Gain on Sale", ja: "暗号資産売却益" },
  sysCryptoLoss: { en: "Crypto Loss on Sale", ja: "暗号資産売却損" },
  sysPropertyGain: { en: "Property Gain on Sale", ja: "固定資産売却益" },
  sysPropertyLoss: { en: "Property Loss on Sale", ja: "固定資産売却損" },
  sysOpeningBalance: { en: "Owner's Equity", ja: "元入金" },
  sysBadDebtLoss: { en: "Bad Debt Loss", ja: "貸倒損失" },
  sysShortTermLending: { en: "Short-term Lending", ja: "短期貸付" },
  sysShortTermLoan: { en: "Short-term Loan", ja: "短期借入" },
  sysAccountBadge: { en: "System", ja: "システム" },
  sysAccountTooltip: {
    en: "System account — cannot be deleted or renamed",
    ja: "システム科目 — 削除・名称変更できません",
  },

  // PlPage — budget check moved notice
  budgetCheckMovedNotice: {
    en: "Budget consistency check has moved to the Trial Balance page.",
    ja: "予算整合性チェックは試算表ページに移動しました。",
  },
  budgetCheckMovedLink: { en: "Go to Trial Balance →", ja: "試算表ページへ →" },

  // Financial Health Indicator (修正指示15)
  fiscalHealthTitle: { en: "Financial Health Index", ja: "財政健全度指標" },
  fiscalHealthSafe: { en: "Healthy", ja: "安全" },
  fiscalHealthCaution: { en: "Caution", ja: "注意" },
  fiscalHealthDanger: { en: "At Risk", ja: "危険" },
  fiscalHealthLiquidity: { en: "Liquidity (30 pts)", ja: "流動性比率（30点）" },
  fiscalHealthEquity: { en: "Equity Ratio (30 pts)", ja: "純資産比率（30点）" },
  fiscalHealthSpending: {
    en: "Spending Reserve (40 pts)",
    ja: "支出余力（40点）",
  },
  fiscalHealthNoExpenseData: {
    en: "Full score — no expense history",
    ja: "満点（費用履歴なし）",
  },
  fiscalHealthCashLabel: { en: "Cash/Deposits", ja: "現金等" },
  fiscalHealthBaseLabel: { en: "Cap", ja: "基準額" },
  fiscalHealthNetWorthLabel: { en: "Net worth", ja: "純資産" },
  fiscalHealthAnnualEstLabel: {
    en: "Est. annual expenses",
    ja: "推計年間費用",
  },
  fiscalHealthBreakdown: { en: "Breakdown", ja: "内訳" },
  fiscalHealthThreshold50: { en: "≥50% = full score", ja: "50%以上で満点" },
  fiscalHealthThreshold60: { en: "≥60% = full score", ja: "60%以上で満点" },
  fiscalHealthThreshold100: { en: "≥100% = full score", ja: "100%以上で満点" },

  // Bulk Edit Page (/settings/bulk_edit)
  bulkEditSectionTitle: { en: "Bulk Edit / Replace", ja: "一括編集・置換" },
  bulkEditSectionDesc: {
    en: "Replace all journal lines for a specific account, or bulk-delete entries matching a condition.",
    ja: "特定の勘定科目の仕訳を一括で別の科目に置き換えたり、条件に合う仕訳を一括削除できます。",
  },
  bulkEditSectionLink: { en: "Bulk Edit / Replace →", ja: "一括編集・置換 →" },
  bulkEditPageTitle: { en: "Bulk Edit / Replace", ja: "一括編集・置換" },
  bulkReplaceTabLabel: {
    en: "Replace Account in Entries",
    ja: "仕訳の科目を置換",
  },
  bulkDeleteTabLabel: { en: "Bulk Delete Entries", ja: "仕訳を一括削除" },
  bulkReplaceFromLabel: {
    en: "Replace from (source account)",
    ja: "置換元科目",
  },
  bulkReplaceToLabel: { en: "Replace to (target account)", ja: "置換先科目" },
  bulkReplacePreviewBtn: { en: "Preview", ja: "プレビュー" },
  bulkReplaceExecBtn: { en: "Execute Replace", ja: "置換を実行" },
  bulkReplaceConfirmTitle: {
    en: "Confirm Account Replace",
    ja: "仕訳置換の確認",
  },
  bulkReplaceConfirmBody: {
    en: 'All journal lines for "{from}" will be replaced with "{to}". This cannot be undone.',
    ja: "「{from}」の全仕訳明細を「{to}」に置き換えます。この操作は元に戻せません。",
  },
  bulkReplacePreviewMsg: {
    en: "{count} journal line(s) will be replaced.",
    ja: "{count}件の仕訳明細が置換対象です。",
  },
  bulkReplaceSuccess: {
    en: "Replaced {count} journal line(s).",
    ja: "{count}件の仕訳明細を置換しました。",
  },
  bulkReplaceNoLines: {
    en: "No journal lines found for the selected account.",
    ja: "選択した科目の仕訳明細はありません。",
  },
  bulkDeleteAccountLabel: {
    en: "Account (optional)",
    ja: "対象科目（省略可）",
  },
  bulkDeleteDateFromLabel: {
    en: "Date from (optional)",
    ja: "開始日（省略可）",
  },
  bulkDeleteDateToLabel: { en: "Date to (optional)", ja: "終了日（省略可）" },
  bulkDeleteDescLabel: {
    en: "Description contains (optional)",
    ja: "摘要に含む文字列（省略可）",
  },
  bulkDeletePreviewBtn: { en: "Preview", ja: "プレビュー" },
  bulkDeleteExecBtn: { en: "Delete Matching Entries", ja: "一括削除を実行" },
  bulkDeleteConfirmTitle: {
    en: "Confirm Bulk Delete",
    ja: "仕訳一括削除の確認",
  },
  bulkDeleteConfirmBody: {
    en: "All matching journal entries will be permanently deleted. This cannot be undone.",
    ja: "条件に合う仕訳をすべて完全に削除します。この操作は元に戻せません。",
  },
  bulkDeletePreviewMsg: {
    en: "{count} journal entry(ies) match the conditions.",
    ja: "{count}件の仕訳が削除対象です。",
  },
  bulkDeleteSuccess: {
    en: "Deleted {count} journal entry(ies).",
    ja: "{count}件の仕訳を削除しました。",
  },
  bulkDeleteNoMatch: {
    en: "No journal entries match the specified conditions.",
    ja: "条件に合う仕訳はありませんでした。",
  },
  bulkDeleteNoCondition: {
    en: "Please specify at least one filter condition.",
    ja: "削除条件を1つ以上指定してください。",
  },
  deleteNonZeroBalanceTooltip: {
    en: "Cannot delete: account has a non-zero balance",
    ja: "残高が0でないため削除できません",
  },
  bulkSelectAll: { en: "Select all", ja: "すべて選択" },
  bulkSelectedCount: {
    en: "{selected} / {total} selected",
    ja: "{selected} / {total} 件選択中",
  },
  bulkReplaceConfirmSuffix: {
    en: "entries will be updated.",
    ja: "件の仕訳を更新します。",
  },

  // Settings sub-page navigation (6-button grid)
  settingsNavCsvTitle: { en: "CSV Import Settings", ja: "CSVインポート設定" },
  settingsNavCsvDesc: {
    en: "Configure store-to-account mappings for CSV import.",
    ja: "CSVインポート時の店舗と科目のマッピングを設定します。",
  },
  settingsNavInitialBalanceDesc: {
    en: "Record opening balances when starting out.",
    ja: "口座の初期残高を記録します。",
  },
  settingsNavBudgetDesc: {
    en: "Manage budget categories and income filters.",
    ja: "予算カテゴリーと収入フィルターを管理します。",
  },
  settingsNavBusinessDesc: {
    en: "Set up accounts for business expense advances.",
    ja: "事業立替金の科目を設定します。",
  },
  settingsNavBulkEditDesc: {
    en: "Replace or bulk-delete journal entries.",
    ja: "仕訳の一括置換・削除を行います。",
  },
  settingsNavDangerDesc: {
    en: "Permanently erase data. Use with caution.",
    ja: "データを完全に削除します。慎重に実行してください。",
  },
  settingsNavGuidesTitle: { en: "User Guide", ja: "使い方ガイド" },
  settingsNavGuidesDesc: {
    en: "Learn about unique features of this app.",
    ja: "このアプリの独自機能について学べます。",
  },
  guidesPageTitle: { en: "User Guide", ja: "使い方ガイド" },
  settingsSubpageBack: { en: "← Settings", ja: "← 設定" },

  // Export page
  settingsNavExportTitle: { en: "Export Reports", ja: "財務レポート出力" },
  settingsNavExportDesc: {
    en: "Download balance sheet and P&L as JSON or PDF.",
    ja: "貸借対照表・損益計算書をJSON・PDFで出力します。",
  },
  exportPeriodLabel: { en: "Report Period", ja: "出力期間" },
  exportFromLabel: { en: "From", ja: "開始日" },
  exportToLabel: { en: "To (BS as-of)", ja: "終了日（BS基準日）" },
  exportJSON: { en: "Download JSON", ja: "JSONでダウンロード" },
  exportJSONC: { en: "Download JSONC", ja: "JSONCでダウンロード" },

  // JSONC export comments
  jsoncFileTitle: {
    en: "Household Financial Report",
    ja: "家計簿財務レポート",
  },
  jsoncFileFormatNote: {
    en: "This file is in JSONC format (JSON with // comments).",
    ja: "このファイルは JSONC 形式です（// コメント付き JSON）。",
  },
  jsoncGeneratedLabel: { en: "Generated", ja: "生成" },
  jsoncPeriodRangeLabel: { en: "Period", ja: "対象期間" },
  jsoncExportedAtComment: {
    en: "ISO 8601 export timestamp",
    ja: "ISO 8601 出力日時",
  },
  jsoncPeriodSection: { en: "Report period", ja: "集計期間" },
  jsoncFromComment: {
    en: "Income statement start date",
    ja: "損益計算書の開始日",
  },
  jsoncToComment: { en: "Income statement end date", ja: "損益計算書の終了日" },
  jsoncBsAsOfComment: {
    en: "Balance sheet as-of date (same as to)",
    ja: "貸借対照表の基準日（to と同じ）",
  },
  jsoncBsSectionTitle: { en: "Balance Sheet", ja: "貸借対照表" },
  jsoncBsNote1: {
    en: "Balances computed as SUM(debit) - SUM(credit) over journal_lines.",
    ja: "残高は journal_lines の SUM(debit) - SUM(credit) でリアルタイム計算。",
  },
  jsoncBsNote2: {
    en: "Assets: debit-heavy = positive. Liabilities/equity: credit-heavy = positive.",
    ja: "資産: 借方超過が正残高。負債・資本: 貸方超過が正残高。",
  },
  jsoncBsNote3: {
    en: "Accounts with balance = 0 are included.",
    ja: "balance = 0 の科目も含まれます。",
  },
  jsoncNetWorthComment: {
    en: "net_worth = total_assets - total_liabilities",
    ja: "純資産 = 資産合計 - 負債合計",
  },
  jsoncPlSectionTitle: { en: "Income Statement", ja: "損益計算書" },
  jsoncPlNote1: {
    en: "income amount = SUM(credit) - SUM(debit) in period.",
    ja: "収益 amount = SUM(credit) - SUM(debit) in period。",
  },
  jsoncPlNote2: {
    en: "expense amount = SUM(debit) - SUM(credit) in period.",
    ja: "費用 amount = SUM(debit) - SUM(credit) in period。",
  },
  jsoncPlNote3: {
    en: "Accounts with amount = 0 are included.",
    ja: "amount = 0 の科目も含まれます。",
  },
  jsoncNetIncomeComment: {
    en: "net_income = total_income - total_expenses",
    ja: "純利益 = 収益合計 - 費用合計",
  },
  jsoncDeprSectionTitle: { en: "Depreciation Progress", ja: "減価償却の進捗" },
  jsoncDeprNote1: {
    en: "Simplified household depreciation: monthly entry DR expense / CR asset.",
    ja: "家計簿用簡易減価償却: 月次仕訳 DR 減価償却費（expense）/ CR 資産（asset）",
  },
  jsoncDeprNote2: {
    en: "book_value = total_amount - accumulated  <- matches asset balance on balance sheet.",
    ja: "book_value = total_amount - accumulated  ← 貸借対照表の資産残高と一致",
  },
  jsoncDeprNote3: {
    en: "progress_pct = accumulated / total_amount x 100 (truncated)",
    ja: "progress_pct = accumulated / total_amount × 100（小数点以下切り捨て）",
  },
  exportPrint: { en: "Print", ja: "印刷" },
  exportSavePDF: { en: "Save as PDF", ja: "PDFとして保存" },
  exportSQLite: { en: "Download SQLite", ja: "SQLiteをダウンロード" },
  exportSchemeLight: { en: "Switch to light", ja: "ライトに切替" },
  exportSchemeDark: { en: "Switch to dark", ja: "ダークに切替" },
  exportDepreciationTitle: {
    en: "Depreciation Progress",
    ja: "減価償却の進捗",
  },
  exportDepreciationNote: {
    en: "Simplified household depreciation: monthly depreciation expense reduces the asset account balance directly via journal entries.",
    ja: "家計簿用簡易減価償却：月次の減価償却費は費用科目を通じて直接資産の帳簿価額を減少させます。",
  },
  exportDepreciationAcquisitionCost: {
    en: "Acquisition Cost",
    ja: "取得価額",
  },
  exportDepreciationPeriod: { en: "Period", ja: "償却期間" },
  exportDepreciationStartDate: { en: "Start Date", ja: "開始日" },
  exportDepreciationAccumulated: { en: "Accumulated", ja: "累計償却額" },
  exportDepreciationBookValue: { en: "Book Value", ja: "残存簿価" },
  exportDepreciationProgress: { en: "Progress", ja: "進捗" },
  exportDepreciationNone: {
    en: "No depreciable assets registered.",
    ja: "減価償却資産の登録がありません。",
  },

  // AccountTable: negative balance warning
  negativeBalanceWarning: {
    en: "This account has a negative balance",
    ja: "この科目の残高がマイナスです",
  },

  // Multi-currency
  settingsNavCurrencyTitle: { en: "Foreign Currency", ja: "外貨選択" },
  settingsNavCurrencyDesc: {
    en: "Enable currencies and cryptocurrencies to use alongside JPY.",
    ja: "JPYと併用する通貨・仮想通貨を有効化します。",
  },
  currencySettingsTitle: { en: "Foreign Currency Settings", ja: "外貨設定" },
  currencySettingsFiatGroup: { en: "Fiat Currencies", ja: "法定通貨" },
  currencySettingsCryptoGroup: { en: "Cryptocurrencies", ja: "仮想通貨" },
  currencySettingsNote: {
    en: "Enable the currencies you use. At least one must always remain enabled.",
    ja: "使用する通貨を有効にしてください。最低1つは常に有効にする必要があります。",
  },
  currencySettingsRateNote: {
    en: "Exchange rates are fetched automatically (30-min cooldown).",
    ja: "為替レートは自動取得されます（クールダウン30分）。",
  },
  currencySettingsApiSourceTitle: {
    en: "Rate Source APIs",
    ja: "レート取得API",
  },
  currencySettingsFiatApiLabel: {
    en: "Fiat Exchange Rates",
    ja: "外貨レート",
  },
  currencySettingsCryptoApiLabel: {
    en: "Crypto Prices",
    ja: "仮想通貨レート",
  },
  currencySettingsApiApplied: {
    en: "Provider changed. Refreshing rates…",
    ja: "プロバイダを変更しました。レートを再取得中…",
  },
  tabFxExchange: { en: "FX Exchange", ja: "外貨両替" },
  fxExchangeTitle: { en: "Currency Exchange", ja: "外貨両替" },
  fxFromCurrency: { en: "Give (currency)", ja: "渡す通貨" },
  fxToCurrency: { en: "Receive (currency)", ja: "受け取る通貨" },
  fxFromAccount: { en: "Source account", ja: "振替元科目" },
  fxToAccount: { en: "Destination account", ja: "振替先科目" },
  fxFromAmount: { en: "Amount given", ja: "渡す金額" },
  fxToAmount: { en: "Amount received", ja: "受け取る金額" },
  includeAllCurrencies: { en: "Include all currencies", ja: "全通貨を含む" },
  displayCurrencyLabel: { en: "Display currency", ja: "表示通貨" },
} as const;

export type TranslationKey = keyof typeof translations;
