export interface TrialBalanceTask {
  id: string;
  scheduledDate: string;
}

interface TrialBalanceTaskInput {
  today: Date;
  enabled: boolean;
  day: number;
  latestSnapshotDate: string | null;
}

export function computeTrialBalanceTask({
  today,
  enabled,
  day,
  latestSnapshotDate,
}: TrialBalanceTaskInput): TrialBalanceTask | null {
  if (!enabled || !Number.isInteger(day) || day < 1 || day > 31) return null;

  const year = today.getFullYear();
  const monthIndex = today.getMonth();
  const yearMonth = `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
  const lastDay = new Date(year, monthIndex + 1, 0).getDate();
  const resolvedDay = Math.min(day, lastDay);
  const scheduledDate = `${yearMonth}-${String(resolvedDay).padStart(2, "0")}`;
  const todayDate = `${yearMonth}-${String(today.getDate()).padStart(2, "0")}`;

  if (todayDate < scheduledDate) return null;
  if (latestSnapshotDate && latestSnapshotDate >= `${yearMonth}-01`) return null;

  return {
    id: `trial-balance-${yearMonth}`,
    scheduledDate,
  };
}
