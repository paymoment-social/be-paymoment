import { getRedis } from "./client";
import { redisKeys } from "./keys";

export type IdempotencyRedis = {
  set(key: string, value: string, expiryMode: "EX", ttlSeconds: number, mode: "NX" | "XX"): Promise<"OK" | null>;
  get(key: string): Promise<string | null>;
  del(key: string): Promise<number>;
};

export type IdempotencyRecord<T = unknown> = {
  status: "processing" | "completed";
  statusCode?: number;
  response?: T;
  createdAt: string;
};

export async function beginIdempotentRequest(scope: string, ownerId: string, key: string, ttlSeconds = 86_400, client: IdempotencyRedis = getRedis() as IdempotencyRedis) {
  const redisKey = redisKeys.idempotency(scope, ownerId, key);
  const record: IdempotencyRecord = { status: "processing", createdAt: new Date().toISOString() };
  const result = await client.set(redisKey, JSON.stringify(record), "EX", ttlSeconds, "NX");
  if (result === "OK") return { acquired: true as const, redisKey, record };
  const existing = await client.get(redisKey);
  return {
    acquired: false as const,
    redisKey,
    record: existing ? JSON.parse(existing) as IdempotencyRecord : undefined,
  };
}

export async function completeIdempotentRequest<T>(redisKey: string, statusCode: number, response: T, ttlSeconds = 86_400, client: IdempotencyRedis = getRedis() as IdempotencyRedis) {
  const record: IdempotencyRecord<T> = {
    status: "completed",
    statusCode,
    response,
    createdAt: new Date().toISOString(),
  };
  await client.set(redisKey, JSON.stringify(record), "EX", ttlSeconds, "XX");
  return record;
}

export async function releaseIdempotentRequest(redisKey: string, client: IdempotencyRedis = getRedis() as IdempotencyRedis) {
  await client.del(redisKey);
}
