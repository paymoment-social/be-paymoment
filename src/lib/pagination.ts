import { AppError } from "./errors";

export type TimeCursor = { created_at: string; id: string; score?: number; ranking_at?: string; pinned?: boolean; pinned_at?: string | null };

export function encodeCursor(value: TimeCursor) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

export function decodeCursor(value?: string | null): TimeCursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<TimeCursor>;
    if (!parsed.created_at || !parsed.id || Number.isNaN(Date.parse(parsed.created_at))) throw new Error("Invalid cursor");
    if (parsed.score !== undefined && (!Number.isFinite(parsed.score) || typeof parsed.score !== "number")) throw new Error("Invalid cursor");
    if (parsed.ranking_at !== undefined && Number.isNaN(Date.parse(parsed.ranking_at))) throw new Error("Invalid cursor");
    if (parsed.pinned !== undefined && typeof parsed.pinned !== "boolean") throw new Error("Invalid cursor");
    if (parsed.pinned_at !== undefined && parsed.pinned_at !== null && Number.isNaN(Date.parse(parsed.pinned_at))) throw new Error("Invalid cursor");
    return { created_at: parsed.created_at, id: parsed.id, ...(parsed.score !== undefined ? { score: parsed.score } : {}), ...(parsed.ranking_at !== undefined ? { ranking_at: parsed.ranking_at } : {}), ...(parsed.pinned !== undefined ? { pinned: parsed.pinned } : {}), ...(parsed.pinned_at !== undefined ? { pinned_at: parsed.pinned_at } : {}) };
  } catch {
    throw new AppError(422, "VALIDATION_ERROR", "The pagination cursor is invalid.", { cursor: "Use the cursor returned by the API." });
  }
}
