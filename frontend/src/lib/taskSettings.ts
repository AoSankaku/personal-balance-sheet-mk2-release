import type {
  TaskSettings,
  UpdateTaskSettingsInput,
} from "@balance-sheet/shared";

export const DEFAULT_TASK_SETTINGS = {
  payday_enabled: true,
  credit_card_import_enabled: true,
  trial_balance_enabled: false,
  trial_balance_day: 1,
  credit_card_withdrawal_risk_enabled: true,
  budget_negative_enabled: true,
  loan_overdue_enabled: true,
  loan_overdue_days: 30,
  account_negative_enabled: true,
} satisfies Required<UpdateTaskSettingsInput>;

const LEGACY_KEYS = [
  "notif:payday",
  "notif:creditCard",
  "notif:trialBalance",
  "notif:trialBalanceDay",
  "notif:creditCardWithdrawalRisk",
  "notif:budgetNegative",
  "notif:loanOverdue",
  "notif:loanOverdueDays",
  "notif:accountNegative",
] as const;

interface TaskSettingsStorage {
  getItem(key: string): string | null;
  removeItem(key: string): void;
}

function enabledUnlessFalse(storage: TaskSettingsStorage, key: string) {
  return storage.getItem(key) !== "false";
}

function integerInRange(
  storage: TaskSettingsStorage,
  key: string,
  fallback: number,
  min: number,
  max: number,
) {
  const raw = storage.getItem(key);
  const parsed = raw === null ? fallback : Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max
    ? parsed
    : fallback;
}

export function readLegacyTaskSettings(
  storage: TaskSettingsStorage,
): Required<UpdateTaskSettingsInput> {
  return {
    payday_enabled: enabledUnlessFalse(storage, "notif:payday"),
    credit_card_import_enabled: enabledUnlessFalse(
      storage,
      "notif:creditCard",
    ),
    trial_balance_enabled:
      storage.getItem("notif:trialBalance") === "true",
    trial_balance_day: integerInRange(
      storage,
      "notif:trialBalanceDay",
      1,
      1,
      31,
    ),
    credit_card_withdrawal_risk_enabled: enabledUnlessFalse(
      storage,
      "notif:creditCardWithdrawalRisk",
    ),
    budget_negative_enabled: enabledUnlessFalse(
      storage,
      "notif:budgetNegative",
    ),
    loan_overdue_enabled: enabledUnlessFalse(storage, "notif:loanOverdue"),
    loan_overdue_days: integerInRange(
      storage,
      "notif:loanOverdueDays",
      30,
      1,
      3650,
    ),
    account_negative_enabled: enabledUnlessFalse(
      storage,
      "notif:accountNegative",
    ),
  };
}

function clearLegacyTaskSettings(storage: TaskSettingsStorage) {
  for (const key of LEGACY_KEYS) storage.removeItem(key);
}

export async function migrateLegacyTaskSettingsIfNeeded(
  serverSettings: TaskSettings,
  storage: TaskSettingsStorage,
  save: (input: UpdateTaskSettingsInput) => Promise<TaskSettings>,
): Promise<TaskSettings> {
  if (serverSettings.configured) {
    clearLegacyTaskSettings(storage);
    return serverSettings;
  }

  const migrated = await save(readLegacyTaskSettings(storage));
  clearLegacyTaskSettings(storage);
  return migrated;
}
