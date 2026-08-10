import { AppError } from "./errors";

export type TimeCursor = { created_at: string; id: string; score?: number };

export function encodeCursor(value: TimeCursor) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

export function decodeCursor(value?: string | null): TimeCursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<TimeCursor>;
    if (!parsed.created_at || !parsed.id || Number.isNaN(Date.parse(parsed.created_at))) throw new Error("Invalid cursor");
    if (parsed.score !== undefined && (!Number.isFinite(parsed.score) || typeof parsed.score !== "number")) throw new Error("Invalid cursor");
    return { created_at: parsed.created_at, id: parsed.id, ...(parsed.score !== undefined ? { score: parsed.score } : {}) };
  } catch {
    throw new AppError(422, "VALIDATION_ERROR", "The pagination cursor is invalid.", { cursor: "Use the cursor returned by the API." });
  }
}
