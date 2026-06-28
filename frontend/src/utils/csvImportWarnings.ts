export type CsvImportWarningRow = {
  isAmazon: boolean;
  isSalaryPending: boolean;
  hasCounterAccount: boolean;
  isPossibleDuplicate: boolean;
};

export function countMissingCounterAccountWarnings(
  rows: CsvImportWarningRow[],
): number {
  return rows.filter(
    (row) =>
      !row.isAmazon &&
      !row.isSalaryPending &&
      !row.hasCounterAccount &&
      !row.isPossibleDuplicate,
  ).length;
}
