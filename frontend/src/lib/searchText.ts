/** Normalize only search comparisons; keep stored text and compatibility symbols intact. */
export function normalizeSearchText(value: string): string {
  return value
    .replace(/[\uFF61-\uFF9F]+/g, (kana) => kana.normalize("NFKC"))
    .normalize("NFC")
    .toLowerCase();
}

export function includesSearchText(value: string, query: string): boolean {
  return normalizeSearchText(value).includes(normalizeSearchText(query));
}
