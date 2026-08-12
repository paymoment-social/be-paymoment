import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { assertDataProtectionConfigured as assertConfigured, config } from "../config";

const VERSION = "v1";
const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const KEY_BYTES = 32;

function encryptionKey() {
  assertConfigured();
  const raw = config().encryptionKey.trim();
  const key = /^[0-9a-f]{64}$/i.test(raw)
    ? Buffer.from(raw, "hex")
    : Buffer.from(raw, "base64url");
  if (key.length !== KEY_BYTES) throw new Error("ENCRYPTION_KEY must be a 32-byte base64url or 64-character hex key.");
  return key;
}

function additionalData(messageId: string, conversationId: string, senderId: string, clientMessageId: string) {
  return `${messageId}:${conversationId}:${senderId}:${clientMessageId}`;
}

export function isEncryptedValue(value: string) {
  return value.startsWith(`${VERSION}:`);
}

export function encryptMessageBody(value: string, context: { messageId: string; conversationId: string; senderId: string; clientMessageId: string }) {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, encryptionKey(), iv);
  cipher.setAAD(Buffer.from(additionalData(context.messageId, context.conversationId, context.senderId, context.clientMessageId)));
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [VERSION, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(":");
}

export function decryptMessageBody(value: string, context: { messageId: string; conversationId: string; senderId: string; clientMessageId: string }) {
  if (!isEncryptedValue(value)) return value;
  const [, ivValue, tagValue, ciphertextValue] = value.split(":");
  if (!ivValue || !tagValue || !ciphertextValue) throw new Error("Encrypted message has an invalid format.");
  const decipher = createDecipheriv(ALGORITHM, encryptionKey(), Buffer.from(ivValue, "base64url"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  decipher.setAAD(Buffer.from(additionalData(context.messageId, context.conversationId, context.senderId, context.clientMessageId)));
  return Buffer.concat([decipher.update(Buffer.from(ciphertextValue, "base64url")), decipher.final()]).toString("utf8");
}

export function assertDataProtectionConfigured() {
  encryptionKey();
  return true;
}
