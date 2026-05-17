export interface LoanSettlementDateState {
  is_settled: number | boolean;
  settled_by_entry_date?: string | null;
  asOf: string;
}

export interface LoanSettlementRow extends LoanSettlementDateState {
  settled_by_journal_entry_id?: number | null;
  settled_at?: string | null;
}

export function isLoanSettlementEffective({
  is_settled,
  settled_by_entry_date,
  asOf,
}: LoanSettlementDateState): boolean {
  if (is_settled !== 1 && is_settled !== true) return false;
  if (!settled_by_entry_date) return true;
  return settled_by_entry_date <= asOf;
}

export function serializeLoanSettlement(row: LoanSettlementRow) {
  return {
    is_settled: isLoanSettlementEffective(row),
    settled_by_journal_entry_id: row.settled_by_journal_entry_id ?? null,
    settled_at: row.settled_at ?? null,
  };
}
