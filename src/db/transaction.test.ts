import { describe, expect, test } from "bun:test";
import { withTransactionRetry } from "./transaction";

describe("transaction retry", () => {
  test("retries serialization failures", async () => {
    let attempts = 0;
    const result = await withTransactionRetry(async () => {
      attempts += 1;
      if (attempts < 3) throw Object.assign(new Error("serialization failure"), { code: "40001" });
      return "committed";
    }, 3);
    expect(result).toBe("committed");
    expect(attempts).toBe(3);
  });

  test("does not retry business errors", async () => {
    let attempts = 0;
    await expect(withTransactionRetry(async () => {
      attempts += 1;
      throw new Error("insufficient balance");
    })).rejects.toThrow("insufficient balance");
    expect(attempts).toBe(1);
  });
});
