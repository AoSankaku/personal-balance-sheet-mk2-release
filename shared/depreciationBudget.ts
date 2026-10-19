/** Explicit budget settings. Null on a schedule means legacy / not configured. */
export type DepreciationBudgetMethod = "assigned" | "special" | "unallocated";
export type DepreciationBudgetStatus = "unset" | "active" | "completed" | "ended";

export interface DepreciationBudgetResetDecision {
  reset_log_id: number;
  action: "continue" | "end" | "carry" | "settle";
  /** Null means unallocated money. */
  settlement_source_category_id?: number | null;
  /** Required only if stable existing timestamps cannot determine the order. */
  same_day_order?: "before" | "after";
  scope?: "category" | "all";
}

export interface DepreciationBudgetRoutingChange {
  date: string;
  monthly_source_category_id: number;
  destination_category_id: number;
}

export interface DepreciationBudgetSettlement {
  key: string;
  date: string;
  amount: number;
  source_category_id: number | null;
}

export interface DepreciationBudgetSettings {
  method: DepreciationBudgetMethod;
  purchase_category_id?: number | null;
  monthly_source_category_id?: number | null;
  confirm_unallocated?: boolean;
  reset_decisions?: DepreciationBudgetResetDecision[];
  routing_changes?: DepreciationBudgetRoutingChange[];
  settlements?: DepreciationBudgetSettlement[];
  end_date?: string | null;
}

export interface DepreciationBudgetProgress {
  method: DepreciationBudgetMethod | null;
  purchase_category_id: number | null;
  monthly_source_category_id: number | null;
  destination_category_id: number | null;
  target_amount: number;
  reimbursed_amount: number;
  remaining_amount: number;
  ended_unreimbursed_amount: number;
  future_amount: number;
  status: DepreciationBudgetStatus;
  currency: string;
  revision: number;
  settings: DepreciationBudgetSettings | null;
}

export interface DepreciationBudgetEvent {
  key: string;
  date: string;
  created_at: string;
  kind: "purchase" | "monthly" | "settlement" | "routing" | "carry";
  source_category_id: number | null;
  destination_category_id: number | null;
  amount: number;
  journal_entry_id: number | null;
}

export interface DepreciationBudgetSnapshot {
  T: number;
  U: number;
  D: number;
  allocatable: number;
  categories: { id: number; name: string; balance: number }[];
  reimbursed_amount: number;
  remaining_amount: number;
}

export interface DepreciationBudgetBoundary {
  reset_log_id: number;
  date: string;
  category_id: number;
  category_name: string;
  scope: "category" | "all";
  scope_confirmation_required?: boolean;
  action_kind?: "continue_or_end" | "carry_or_settle";
  required_action: "continue_or_end" | "carry_or_settle" | "order" | null;
  old_reset_amount: number;
  new_reset_amount: number;
}

export interface DepreciationBudgetPreview {
  schedule_id: number;
  token: string;
  settings: DepreciationBudgetSettings;
  progress: DepreciationBudgetProgress;
  boundaries: DepreciationBudgetBoundary[];
  timeline: {
    date: string;
    label: string;
    created_at?: string;
    reset_log_id?: number;
    before: DepreciationBudgetSnapshot;
    after: DepreciationBudgetSnapshot;
  }[];
  changes: { operation: "add" | "change" | "cancel"; event: DepreciationBudgetEvent }[];
  warnings: string[];
  can_apply: boolean;
}

export interface ApplyDepreciationBudgetInput {
  token: string;
  settings: DepreciationBudgetSettings;
  confirmed: boolean;
}

export interface DepreciationResetPlan {
  schedule_id: number;
  description: string;
  method: "assigned" | "special";
  remaining_amount: number;
  special_category_id: number | null;
  monthly_source_category_id: number | null;
  destination_category_id: number | null;
}

export interface DepreciationResetInputDecision {
  schedule_id: number;
  action: "continue" | "end" | "carry" | "settle";
  settlement_source_category_id?: number | null;
}
