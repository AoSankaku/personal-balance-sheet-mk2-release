export const D1_IN_CLAUSE_CHUNK_SIZE = 50;

export function chunkForD1InClause<T>(
  values: readonly T[],
  size = D1_IN_CLAUSE_CHUNK_SIZE,
): T[][] {
  if (!Number.isInteger(size) || size <= 0) {
    throw new Error("D1 IN-clause chunk size must be a positive integer");
  }

  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}
