import { afterEach, describe, expect, test } from "bun:test";
import { decryptMessageBody, encryptMessageBody } from "./data-protection";

const previousKey = process.env.ENCRYPTION_KEY;
const context = { messageId: "11111111-1111-4111-8111-111111111111", conversationId: "22222222-2222-4222-8222-222222222222", senderId: "33333333-3333-4333-8333-333333333333", clientMessageId: "client-message-1" };

afterEach(() => {
  if (previousKey === undefined) delete process.env.ENCRYPTION_KEY;
  else process.env.ENCRYPTION_KEY = previousKey;
});

describe("message data protection", () => {
  test("encrypts and decrypts message bodies", () => {
    process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64url");
    const encrypted = encryptMessageBody("Pesan rahasia", context);
    expect(encrypted).not.toContain("Pesan rahasia");
    expect(decryptMessageBody(encrypted, context)).toBe("Pesan rahasia");
  });

  test("rejects tampered ciphertext or context", () => {
    process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64url");
    const encrypted = encryptMessageBody("Pesan rahasia", context);
    const parts = encrypted.split(":");
    parts[3] = `${parts[3]}a`;
    expect(() => decryptMessageBody(parts.join(":"), context)).toThrow();
    expect(() => decryptMessageBody(encrypted, { ...context, senderId: "44444444-4444-4444-8444-444444444444" })).toThrow();
  });
});
