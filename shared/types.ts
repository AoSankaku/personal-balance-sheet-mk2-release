export type AccountType =
  | "asset"
  | "liability"
  | "equity"
  | "income"
  | "expense";

export type AccountCategory =
  // asset
  | "cash"
  | "investment"
  | "property"
  | "crypto"
  | "lending" // legacy = short_term_lending
  | "short_term_lending" // short-term informal loans receivable
  | "long_term_lending" // long-term loans receivable (dedicated account per loanee)
  | "business_advance" // business advances (asset: money paid on behalf of business; liability: money received on behalf of business) — only for business owners
  // liability
  | "loan" // legacy = long_term_loan
  | "long_term_loan" // long-term loans payable (dedicated account per lender)
  | "credit_card"
  | "short_term_loan" // short-term informal loans payable
  // equity
  | "opening_balance"
  // income
  | "salary"
  | "business"
  // expense
  | "food"
  | "rent"
  | "transport"
  | "utilities"
  | "entertainment"
  | "daily_goods" // 生活雑費
  | "social" // 交際費
  | "investment_loss" // 投資損失
  // shared
  | "other";

/** Returns true for short-term lending asset categories (informal / catch-all) */
export function isShortTermLendingCategory(cat: AccountCategory): boolean {
  return cat === "lending" || cat === "short_term_lending";
}
/** Returns true for long-term lending asset categories (dedicated account per loanee) */
export function isLongTermLendingCategory(cat: AccountCategory): boolean {
  return cat === "long_term_lending";
}
/** Returns true for any lending asset category (personal loans only — excludes business advances) */
export function isAnyLendingCategory(cat: AccountCategory): boolean {
  return isShortTermLendingCategory(cat) || isLongTermLendingCategory(cat);
}
/** Returns true for business advance categories (business owners only) */
export function isBusinessAdvanceCategory(cat: AccountCategory): boolean {
  return cat === "business_advance";
}
/** Returns true for short-term borrowing liability categories */
export function isShortTermBorrowingCategory(cat: AccountCategory): boolean {
  return cat === "short_term_loan";
}
/** Returns true for long-term borrowing liability categories */
export function isLongTermBorrowingCategory(cat: AccountCategory): boolean {
  return cat === "loan" || cat === "long_term_loan";
}
/** Returns true for any short-term loan category (lending or borrowing) */
export function isShortTermLoanCategory(cat: AccountCategory): boolean {
  return isShortTermLendingCategory(cat) || isShortTermBorrowingCategory(cat);
}
/** Returns true for any long-term loan category (lending or borrowing) */
export function isLongTermLoanCategory(cat: AccountCategory): boolean {
  return isLongTermLendingCategory(cat) || isLongTermBorrowingCategory(cat);
}

/** Budget distribution ratio for an expense account → budget category link */
export interface AccountBudgetRatio {
  budget_category_id: number;
  budget_category_name?: string;
  /** Percentage 0-100 of this account's spending that counts toward this category */
  ratio: number;
}

export interface Account {
  id: number;
  name: string;
  type: AccountType;
  category: AccountCategory;
  created_at: string;
  /** Total balance (sum of all currencies as raw numbers — use `balances` for currency-aware display) */
  balance?: number | null;
  /** Per-currency balances: { "JPY": 10000, "USD": 500 }. Populated on GET /api/accounts. */
  balances?: Record<string, number>;
  /** Day of month (0=end of month, 1-31) when salary/income is expected; only for income accounts */
  payday?: number | null;
  /** Budget distribution ratios (only populated for expense-type accounts) */
  budget_ratios?: AccountBudgetRatio[];
  /** True if this asset account represents a depreciable item (備品等) */
  is_depreciable?: boolean;
  /** True if this cash/bank asset account is counted as allocatable budget money */
  include_in_allocatable?: boolean;
  /** True if this is a special system account (不明金, 雑損, 雑益) — not editable/deletable */
  is_system?: boolean;
  /** True if this long-term loan/lending account has been marked as completed (balance reached 0) */
  is_completed?: boolean;
}

export interface CreateAccountInput {
  name: string;
  type: AccountType;
  category: AccountCategory;
  /** Day of month (0=end of month, 1-31) for income accounts; omit or null for no payday */
  payday?: number | null;
  /** Budget distribution ratios — only relevant for expense-type accounts */
  budget_ratios?: AccountBudgetRatio[];
  /** Mark this asset account as a depreciable item */
  is_depreciable?: boolean;
  /** Include this cash/bank asset account in allocatable budget money */
  include_in_allocatable?: boolean;
}

export interface JournalLine {
  id: number;
  journal_entry_id: number;
  account_id: number;
  account_name: string;
  debit: number;
  credit: number;
  currency: string;
  credit_card_billing_offset_months?: number | null;
}

export interface JournalEntry {
  id: number;
  date: string;
  description: string;
  /** Origin of this entry: 'manual' (direct input) or 'csv_import' (batch CSV import). Null for legacy entries. */
  source?: "manual" | "csv_import" | null;
  created_at: string;
  lines: JournalLine[];
  budget_allocations?: {
    budget_category_id: number;
    amount: number;
    currency?: string;
    source?: string | null;
  }[];
  income_budget_allocations?: {
    budget_category_id: number;
  amount: number;
  currency?: string;
  note?: string | null;
  adjustment_type?: "allocation" | "reset" | "transfer";
}[];
  /** Set when this entry is the purchase entry for a depreciation schedule */
  depreciation_schedule_id?: number | null;
  /** Whether this journal entry is the source purchase or a monthly depreciation entry */
  depreciation_entry_kind?: "source" | "monthly" | null;
  /** Present when this entry opened a short-term loan/lending settlement record */
  loan_settlement?: {
    is_settled: boolean;
    settled_by_journal_entry_id?: number | null;
    settled_at?: string | null;
  } | null;
}

export interface CreateJournalLineInput {
  account_id: number;
  debit: number;
  credit: number;
  currency?: string;
  credit_card_billing_offset_months?: number | null;
}

export interface CreateJournalInput {
  date: string;
  description: string;
  lines: CreateJournalLineInput[];
  /** Per-entry budget allocations for expense tracking (stored in journal_entry_budget_allocations) */
  budget_allocations?: {
    budget_category_id: number;
    amount: number;
    currency?: string;
  }[];
  /** Source of the entry: 'simple' (SimpleEntryForm) or 'multiline' (multi-line form) */
  budget_source?: "simple" | "multiline";
  /** Income budget allocations (stored in budget_adjustment_logs, linked by journal_entry_id) */
  income_budget_allocations?: {
    budget_category_id: number;
  amount: number;
  currency?: string;
  note?: string | null;
  adjustment_type?: "allocation" | "reset" | "transfer";
}[];
  /** If true, this entry opens a new short-term loan/lending — creates a loan_settlements record */
  loan_settlement_opening?: boolean;
  /** IDs of opening loan_settlements entries that are being settled by this repayment/collection */
  loan_settlement_journal_entry_ids?: number[];
  /** When true, skip the debit=credit balance check (used for currency exchange entries) */
  is_currency_exchange?: boolean;
}

/** A single unsettled short-term loan event (opening entry not yet repaid/collected) */
export interface UnsettledLoanEntry {
  journal_entry_id: number;
  date: string;
  description: string;
  /** Net amount of the loan/lending in this entry (debit-normal for asset, credit-normal for liability) */
  amount: number;
  /** Currency of the unsettled loan/lending amount */
  currency: string;
  /** True when this entry was already settled by the entry currently being edited */
  already_settled_by_current?: boolean;
}

export interface PLReport {
  income: number;
  expense: number;
  net_income: number;
}

export interface NetWorthSnapshot {
  date: string;
  assets: number;
  liabilities: number;
  net_worth: number;
}

export type CryptoChain =
  | "eth"
  | "btc"
  | "sol"
  | "skr"
  | "msol"
  | "sol_stake"
  | "binance";

export interface CryptoWallet {
  id: number;
  account_id: number;
  account_name?: string;
  address: string;
  chain: CryptoChain;
  created_at: string;
}

export interface CreateCryptoWalletInput {
  account_id: number;
  address: string;
  chain?: CryptoChain;
}

export interface CryptoBalance {
  address: string;
  chain: CryptoChain;
  amount: number;
}

export interface ExchangeCredential {
  id: number;
  exchange: string;
  api_key: string;
  created_at: string;
  // api_secret is intentionally omitted from API responses
}

export interface CreateExchangeCredentialInput {
  exchange: string;
  api_key: string;
  api_secret: string;
}

export interface CryptoPrices {
  bitcoin: number;
  ethereum: number;
  solana: number;
  skr: number | null; // null when CoinGecko doesn't list it yet
  bnb: number | null;
  /** Uppercase ticker → JPY price (covers all fetched coins) */
  byTicker: Record<string, number>;
}

export interface ReplaceAccountBody {
  replace_with_id: number;
}

export interface BudgetCategory {
  id: number;
  name: string;
  sort_order: number;
  rollover_months: number;
  budget_group: string;
  goal_balance?: number | null;
  balance_cap?: number | null;
  overflow_budget_category_id?: number | null;
  is_archived?: boolean;
  account_ids: number[];
  target_accounts?: BudgetCategoryAccountTarget[];
  created_at: string;
}

export interface BudgetCategoryAccountTarget {
  account_id: number;
  account_name?: string;
  ratio: number;
}

export interface CreateBudgetCategoryInput {
  name: string;
  sort_order?: number;
  rollover_months?: number;
  budget_group?: string;
  goal_balance?: number | null;
  balance_cap?: number | null;
  overflow_budget_category_id?: number | null;
  is_archived?: boolean;
  account_ids?: number[];
  target_accounts?: BudgetCategoryAccountTarget[];
}

export interface UpdateBudgetCategoryInput {
  name?: string;
  sort_order?: number;
  rollover_months?: number;
  budget_group?: string;
  goal_balance?: number | null;
  balance_cap?: number | null;
  overflow_budget_category_id?: number | null;
  is_archived?: boolean;
  account_ids?: number[];
  target_accounts?: BudgetCategoryAccountTarget[];
}

export interface BudgetAllocation {
  id: number;
  budget_category_id: number;
  year_month: string;
  currency: string;
  fixed_amount: number;
  income_ratio: number;
  adhoc_amount: number;
}

export interface UpsertBudgetAllocationInput {
  budget_category_id: number;
  year_month: string;
  currency?: string;
  fixed_amount?: number;
  income_ratio?: number;
  adhoc_amount?: number;
}

export interface BudgetCategorySummary {
  category: BudgetCategory;
  budget_base: number;
  carryover: number;
  show_carryover?: boolean;
  reset_date?: string | null;
  total_budget: number;
  spent: number;
  available: number;
  /** Number of distinct months with non-zero contributions (budget adjustment log entries) */
  months_with_contributions: number;
}

export interface BudgetSummary {
  year_month: string;
  currency: string;
  monthly_income: number;
  categories: BudgetCategorySummary[];
  total_budget: number;
  total_spent: number;
  total_available: number;
}

export interface BudgetHistoryResponse {
  from: string;
  to: string;
  currency: string;
  summaries: BudgetSummary[];
}

export type BudgetFilterStepType = "fixed" | "capped" | "remainder";

export interface BudgetFilterStepAllocation {
  id: number;
  step_id: number;
  budget_category_id: number;
  amount: number | null;
  ratio: number | null;
}

export interface BudgetFilterStep {
  id: number;
  filter_id: number;
  step_order: number;
  step_type: BudgetFilterStepType;
  allocations: BudgetFilterStepAllocation[];
}

export interface BudgetFilter {
  id: number;
  name: string;
  is_active: boolean;
  currency: string;
  created_at: string;
  steps: BudgetFilterStep[];
}

export interface CreateBudgetFilterStepAllocationInput {
  budget_category_id: number;
  amount?: number;
  ratio?: number;
}

export interface CreateBudgetFilterStepInput {
  step_order: number;
  step_type: BudgetFilterStepType;
  allocations: CreateBudgetFilterStepAllocationInput[];
}

export interface CreateBudgetFilterInput {
  name: string;
  currency?: string;
  steps: CreateBudgetFilterStepInput[];
}

export interface BudgetAdjustmentLog {
  id: number;
  budget_category_id: number;
  budget_category_name: string | null;
  year_month: string;
  amount: number;
  currency: string;
  date: string;
  created_at: string;
  note?: string | null;
  type:
    | "manual"
    | "reset"
    | "income"
    | "transfer"
    | "simple"
    | "multiline";
  adjustment_type?: "allocation" | "reset" | "transfer";
  journal_entry_id?: number;
}

export interface BudgetSettings {
  /** Ordered list of preferred payment account IDs (up to 5). First = default. */
  preferred_payment_account_ids: number[];
  /** Ordered list of preferred filter IDs (up to 5). Shown first in income entry dropdown. */
  preferred_filter_ids: number[];
  /** Whether the user is a sole proprietor (個人事業主) */
  is_business_owner: boolean;
  /** Default asset account for business expense advances (事業立替金科目) */
  business_advance_account_id?: number | null;
  /** Expense account to use when disposing advance as loss (損失として破棄する場合の科目) */
  business_loss_account_id?: number | null;
  /** Budget category to deduct business advance amounts from (事業立替金の予算元) */
  business_advance_budget_category_id?: number | null;
}

export interface DepreciationSchedule {
  id: number;
  source_journal_entry_id: number;
  asset_account_id: number;
  asset_account_name: string;
  expense_account_id: number;
  expense_account_name: string;
  payment_account_name: string;
  total_amount: number;
  months: number;
  start_date: string;
  description: string;
  created_at: string;
  /** Monthly amounts array [month1, month2, ..., monthN] */
  monthly_amounts: number[];
  /** Dates for each monthly entry [date1, date2, ..., dateN] */
  entry_dates: string[];
}

export interface CreateDepreciationInput {
  purchase_date: string;
  description: string;
  asset_account_id: number;
  payment_account_id: number;
  expense_account_id: number;
  total_amount: number;
  months: number;
}

export interface UpdateDepreciationInput {
  purchase_date?: string;
  description?: string;
  total_amount?: number;
  months?: number;
  asset_account_id?: number;
  expense_account_id?: number;
  payment_account_id?: number;
}

export interface DepreciationReportEntry {
  schedule_id: number;
  description: string;
  asset_account_name: string;
  total_amount: number;
  months: number;
  start_date: string;
  amount_in_period: number;
}

export interface DepreciationReport {
  period: string;
  total_depreciation: number;
  entries: DepreciationReportEntry[];
}

export interface ActualBalanceGeneralEntry {
  id: number;
  snapshot_id: number;
  account_id: number;
  account_name: string;
  amount: number;
  /** Book value at snapshot time (computed from journal_lines) */
  book_value: number;
}

export type CreditCardSnapshotStatus = "open" | "confirmed" | "paid";

export interface ActualBalanceSnapshot {
  id: number;
  snapshot_date: string;
  /** Optional HH:MM time label (e.g. "14:30") */
  snapshot_time: string | null;
  created_at: string;
  general_entries: ActualBalanceGeneralEntry[];
}

export interface CreateActualBalanceSnapshotInput {
  snapshot_date: string;
  /** Optional HH:MM time label sent from the client at save time */
  snapshot_time?: string;
  general_entries: {
    account_id: number;
    amount: number;
  }[];
}

export interface CreditCardStateEntry {
  id: number;
  account_id: number;
  account_name: string;
  payment_month: string;
  status: CreditCardSnapshotStatus;
  amount: number;
  last_updated_at: string;
}

export interface SaveCreditCardStateInput {
  entries: {
    account_id: number;
    payment_month: string;
    amount: number;
    status: CreditCardSnapshotStatus;
  }[];
}

export interface CreditCardCycleSettings {
  closing_day: number;
  confirmation_day: number;
  withdrawal_day: number;
  billing_offset_months?: number | null;
}

export function shiftCreditCardMonth(month: string, delta: number): string {
  const match = month.match(/^(\d{4})-(\d{2})$/);
  if (!match) {
    return month;
  }
  const year = Number(match[1]);
  const monthPart = Number(match[2]);
  const next = new Date(year, monthPart - 1 + delta, 1);
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`;
}

export function statementMonthForTransactionDate(
  transactionDate: string,
  closingDay: number,
): string {
  const match = transactionDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return transactionDate.slice(0, 7);
  }
  const day = Number(match[3]);
  const yearMonth = `${match[1]}-${match[2]}`;
  if (closingDay === 0) return yearMonth;

  const resolvedClosingDay = resolveCreditCardMonthDay(yearMonth, closingDay);
  if (day <= resolvedClosingDay) return yearMonth;

  return shiftCreditCardMonth(yearMonth, 1);
}

export function statementMonthWithTransactionOffset(
  transactionDate: string,
  closingDay: number,
  offsetMonths: number,
): string {
  return shiftCreditCardMonth(
    statementMonthForTransactionDate(transactionDate, closingDay),
    Math.max(0, offsetMonths),
  );
}

export function diffCreditCardMonths(
  fromMonth: string,
  toMonth: string,
): number {
  const fromMatch = fromMonth.match(/^(\d{4})-(\d{2})$/);
  const toMatch = toMonth.match(/^(\d{4})-(\d{2})$/);
  if (!fromMatch || !toMatch) return 0;
  return (
    (Number(toMatch[1]) - Number(fromMatch[1])) * 12 +
    (Number(toMatch[2]) - Number(fromMatch[2]))
  );
}

export function creditCardBillingOffsetMonths(
  settings?: Pick<CreditCardCycleSettings, "billing_offset_months">,
): number {
  return Math.max(1, (settings?.billing_offset_months ?? 0) + 1);
}

export function lastDayOfCreditCardMonth(month: string): number {
  const match = month.match(/^(\d{4})-(\d{2})$/);
  if (!match) return 31;
  return new Date(Number(match[1]), Number(match[2]), 0).getDate();
}

export function resolveMonthlyPayday(month: string, payday: number): number {
  const lastDay = lastDayOfCreditCardMonth(month);
  if (payday === 0) return lastDay;
  return Math.min(Math.max(payday, 1), lastDay);
}

export function resolveCreditCardMonthDay(
  month: string,
  daySetting: number,
): number {
  if (daySetting === 0) return lastDayOfCreditCardMonth(month);
  return Math.min(daySetting, lastDayOfCreditCardMonth(month));
}

export function usagePeriodForStatementMonth(
  statementMonth: string,
  closingDay: number,
): { start: string; end: string } {
  const currentClosingDay = resolveCreditCardMonthDay(
    statementMonth,
    closingDay,
  );
  if (closingDay === 0) {
    return {
      start: `${statementMonth}-01`,
      end: `${statementMonth}-${String(currentClosingDay).padStart(2, "0")}`,
    };
  }

  const prevMonth = shiftCreditCardMonth(statementMonth, -1);
  const prevClosingDay = resolveCreditCardMonthDay(prevMonth, closingDay);
  const startDate = new Date(
    `${prevMonth}-${String(prevClosingDay).padStart(2, "0")}T00:00:00`,
  );
  startDate.setDate(startDate.getDate() + 1);
  return {
    start: startDate.toISOString().slice(0, 10),
    end: `${statementMonth}-${String(currentClosingDay).padStart(2, "0")}`,
  };
}

export function paymentMonthForStatementMonth(
  statementMonth: string,
  settings?: Pick<CreditCardCycleSettings, "billing_offset_months">,
): string {
  return shiftCreditCardMonth(
    statementMonth,
    creditCardBillingOffsetMonths(settings),
  );
}

export function paymentDateForStatementMonth(
  statementMonth: string,
  withdrawalDay: number,
  settings?: Pick<CreditCardCycleSettings, "billing_offset_months">,
): string {
  const paymentMonth = paymentMonthForStatementMonth(statementMonth, settings);
  const day = resolveCreditCardMonthDay(paymentMonth, withdrawalDay);
  return `${paymentMonth}-${String(day).padStart(2, "0")}`;
}

export function deriveCreditCardStatus(
  snapshotDate: string,
  statementMonth: string,
  settings?: CreditCardCycleSettings,
): CreditCardSnapshotStatus {
  if (!settings) {
    return statementMonth === snapshotDate.slice(0, 7) ? "open" : "confirmed";
  }
  const period = usagePeriodForStatementMonth(
    statementMonth,
    settings.closing_day,
  );
  const paymentDate = paymentDateForStatementMonth(
    statementMonth,
    settings.withdrawal_day,
    settings,
  );
  if (snapshotDate < period.end) return "open";
  if (snapshotDate < paymentDate) return "confirmed";
  return "paid";
}

export interface CreditCardSettings {
  id: number;
  account_id: number;
  closing_day: number;
  confirmation_day: number;
  withdrawal_day: number;
  billing_offset_months: number;
  withdrawal_account_id?: number | null;
  created_at: string;
}

export interface CreateCreditCardSettingsInput {
  account_id: number;
  closing_day: number;
  confirmation_day: number;
  withdrawal_day: number;
  billing_offset_months?: number;
  withdrawal_account_id?: number | null;
}

export interface BatchCreateJournalInput {
  entries: CreateJournalInput[];
}

export interface StoreAccountMapping {
  id: number;
  store_name: string;
  account_id: number;
  account_name: string | null;
  created_at: string;
}

export interface UpsertStoreAccountMappingInput {
  store_name: string;
  account_id: number;
}

export interface EnabledCurrency {
  id: number;
  code: string;
  sort_order: number;
  symbol_priority: number;
  custom_symbol: string | null;
  custom_icon: string | null;
  background_color: string | null;
  decimal_places: number;
  created_at: string;
}

/** Fiat and crypto rates relative to JPY: { USD: 150.5, BTC: 14000000, ... } */
export type ExchangeRates = Record<string, number>;

// ── Long-term loan/lending repayment plans ─────────────────────────────────

export interface LongTermLoanPlanRow {
  id: number;
  plan_id: number;
  year_month: string;
  principal_amount: number;
  interest_amount: number;
  note: string | null;
  created_at: string;
}

export interface LongTermLoanPlan {
  id: number;
  account_id: number;
  note: string | null;
  currency: string;
  total_principal: number | null;
  annual_interest_rate: number | null;
  monthly_payment: number | null;
  start_year_month: string | null;
  created_at: string;
  updated_at: string;
  rows: LongTermLoanPlanRow[];
}

export interface UpsertLongTermLoanPlanInput {
  account_id: number;
  note?: string | null;
  currency?: string;
  total_principal?: number | null;
  annual_interest_rate?: number | null;
  monthly_payment?: number | null;
  start_year_month?: string | null;
}

export interface UpsertLongTermLoanPlanRowInput {
  year_month: string;
  principal_amount: number;
  interest_amount: number;
  note?: string | null;
}

/** A single row in the plan-vs-actual comparison table */
export interface LongTermLoanComparisonRow {
  year_month: string;
  planned_principal: number;
  planned_interest: number;
  actual_principal: number;
  actual_interest: number;
  /** journal entry IDs that contributed to this month's actual amounts */
  actual_journal_entry_ids: number[];
}
