import { isBankFormat, type CsvFormat } from "../utils/csvParser";

export const KOTORA_AUTO_MASK_STORAGE_KEY = "csv:kotoraAutoMaskTransferNumbers";

export function parseKotoraAutoMaskPreference(value: string | null | undefined): boolean {
  return value === "true";
}

export function getCsvImportDescription(original: string, note?: string): string {
  return note === undefined || note.trim() === "" ? original : note;
}

/** Preserve the name and wording; replace only the trailing numeric reference. */
export function maskKotoraTransferNumber(description: string): string {
  const reference = /([（(])\s*[0-9０-９]+\s*([）)])(?=\s*$)/u.exec(description);
  if (!reference) return description;
  const beforeReference = description.slice(0, reference.index);
  const compact = beforeReference.normalize("NFKC").replace(/\s+/gu, "");
  if (!/^(?:ことら送金|コトラ送金|コトラソウキン).+$/u.test(compact)) {
    return description;
  }
  return beforeReference + `${reference[1]}****${reference[2]}` +
    description.slice(reference.index + reference[0].length);
}

export function reviewKotoraTransferDescriptions(
  format: CsvFormat,
  descriptions: readonly string[],
  maskNumbers: boolean,
): { descriptions: string[]; warningIndices: number[]; maskedCount: number } {
  const warningIndices: number[] = [];
  let maskedCount = 0;
  const reviewed = descriptions.map((description, index) => {
    if (!isBankFormat(format)) return description;
    const masked = maskKotoraTransferNumber(description);
    if (masked === description) return description;
    if (!maskNumbers) {
      warningIndices.push(index);
      return description;
    }
    maskedCount++;
    return masked;
  });
  return { descriptions: reviewed, warningIndices, maskedCount };
}
