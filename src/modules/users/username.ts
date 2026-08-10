import { AppError } from "../../lib/errors";

const USERNAME_PATTERN = /^[a-z0-9](?:[a-z0-9._]{1,28}[a-z0-9])?$/;
const RESERVED_USERNAMES = new Set([
  "admin", "administrator", "api", "auth", "discover", "help", "login", "logout",
  "mcp", "messages", "notifications", "paymoment", "root", "settings", "support", "system",
]);

export function normalizeUsername(value: string) {
  return value.normalize("NFKC").trim().replace(/^@/, "").toLowerCase();
}

export function validateUsername(value: string) {
  const normalized = normalizeUsername(value);
  if (!USERNAME_PATTERN.test(normalized)) {
    throw new AppError(422, "VALIDATION_ERROR", "The username must be 3 to 30 characters and may contain letters, numbers, periods, and underscores.", { username: "Enter a valid username." });
  }
  if (normalized.includes("..") || normalized.includes("__") || normalized.includes("._") || normalized.includes("_.")) {
    throw new AppError(422, "VALIDATION_ERROR", "The username cannot contain consecutive punctuation.", { username: "Remove consecutive punctuation." });
  }
  if (RESERVED_USERNAMES.has(normalized)) {
    throw new AppError(409, "USERNAME_TAKEN", "This username is reserved.", { username: "Choose another username." });
  }
  return normalized;
}

export function cleanDisplayName(value: string) {
  const displayName = value.normalize("NFKC").replace(/[\u0000-\u001F\u007F]/g, "").replace(/\s+/g, " ").trim();
  if (!displayName || displayName.length > 80) {
    throw new AppError(422, "VALIDATION_ERROR", "The display name must contain 1 to 80 characters.", { display_name: "Enter a valid display name." });
  }
  return displayName;
}
