import { describe, expect, test } from "bun:test";
import { decodeCursor, encodeCursor } from "./pagination";

describe("pagination cursor", () => {
  test("keeps a stable ranking timestamp across feed pages", () => {
    const cursor = {
      created_at: "2026-08-11T00:00:00.000Z",
      id: "00000000-0000-4000-8000-000000000001",
      score: 42.5,
      ranking_at: "2026-08-11T01:00:00.000Z",
    };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });
});
