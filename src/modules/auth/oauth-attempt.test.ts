import { describe, expect, test } from "bun:test";
import { safeReturnPath } from "./oauth-attempt";

describe("OAuth return paths", () => {
  test("keeps local application paths", () => {
    expect(safeReturnPath("/discover?q=ai")).toBe("/discover?q=ai");
  });

  test("rejects external and protocol-relative redirects", () => {
    expect(safeReturnPath("https://attacker.example")).toBe("/");
    expect(safeReturnPath("//attacker.example/path")).toBe("/");
    expect(safeReturnPath("/\\attacker.example")).toBe("/");
  });
});
