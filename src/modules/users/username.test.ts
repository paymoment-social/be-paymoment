import { describe, expect, test } from "bun:test";
import { AppError } from "../../lib/errors";
import { cleanDisplayName, normalizeUsername, validateUsername } from "./username";

describe("username and display name rules", () => {
  test("normalizes handles consistently", () => {
    expect(normalizeUsername(" @Tuan.Bayu ")).toBe("tuan.bayu");
    expect(validateUsername("Tuan_Bayu")).toBe("tuan_bayu");
  });

  test("rejects reserved and malformed usernames", () => {
    expect(() => validateUsername("admin")).toThrow(AppError);
    expect(() => validateUsername("bad..name")).toThrow(AppError);
  });

  test("normalizes display name whitespace", () => {
    expect(cleanDisplayName("  Tuan   Bayu  ")).toBe("Tuan Bayu");
  });
});
