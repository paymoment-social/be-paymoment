import { describe, expect, test } from "bun:test";
import { retryDecision, retryDelayMilliseconds } from "./retry-policy";

describe("background retry policy", () => {
  test("uses bounded exponential backoff", () => {
    expect(retryDelayMilliseconds(1)).toBe(1_000);
    expect(retryDelayMilliseconds(4)).toBe(8_000);
    expect(retryDelayMilliseconds(20)).toBe(900_000);
  });

  test("dead-letters exhausted work", () => {
    const now = new Date("2026-08-10T00:00:00.000Z");
    expect(retryDecision(3, 3, now)).toEqual({ status: "dead_lettered", nextAttemptAt: null });
    expect(retryDecision(2, 3, now).nextAttemptAt?.toISOString()).toBe("2026-08-10T00:00:02.000Z");
  });
});
