import { describe, expect, test } from "bun:test";
import {
  chunkForD1InClause,
  D1_IN_CLAUSE_CHUNK_SIZE,
} from "../src/lib/d1Query";

describe("D1 IN-clause chunking", () => {
  test("keeps every query below the D1 bind-parameter limit", () => {
    const values = Array.from(
      { length: D1_IN_CLAUSE_CHUNK_SIZE * 2 + 8 },
      (_, index) => index + 1,
    );

    const chunks = chunkForD1InClause(values);

    expect(chunks.map((chunk) => chunk.length)).toEqual([
      D1_IN_CLAUSE_CHUNK_SIZE,
      D1_IN_CLAUSE_CHUNK_SIZE,
      8,
    ]);
    expect(chunks.flat()).toEqual(values);
  });

  test("does not issue an empty IN query", () => {
    expect(chunkForD1InClause([])).toEqual([]);
  });
});
