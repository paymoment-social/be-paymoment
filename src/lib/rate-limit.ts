import type { Context } from "hono";
import { consumeRateLimit } from "../integrations/redis";
import { AppError } from "./errors";

export async function enforceRateLimit(c: Context, scope: string, identity: string, limit: number, windowSeconds: number) {
  const result = await consumeRateLimit(scope, identity, limit, windowSeconds);
  c.header("X-RateLimit-Limit", String(result.limit));
  c.header("X-RateLimit-Remaining", String(result.remaining));
  if (!result.allowed) {
    c.header("Retry-After", String(result.retryAfterSeconds));
    throw new AppError(429, "RATE_LIMITED", "Too many requests. Try again later.");
  }
  return result;
}
