import { describe, expect, test } from "bun:test";
import {
  beginIdempotentRequest,
  completeIdempotentRequest,
  consumeRateLimit,
  redisKeys,
  type IdempotencyRedis,
  type RateLimitRedis,
} from ".";

function inMemoryIdempotencyRedis(): IdempotencyRedis {
  const records = new Map<string, string>();
  return {
    async set(key, value, _expiryMode, _ttl, mode) {
      if (mode === "NX" && records.has(key)) return null;
      if (mode === "XX" && !records.has(key)) return null;
      records.set(key, value);
      return "OK";
    },
    async get(key) { return records.get(key) ?? null; },
    async del(key) { return records.delete(key) ? 1 : 0; },
  };
}

describe("Redis foundation", () => {
  test("builds namespaced and normalized keys", () => {
    expect(redisKeys.presence("USER/One")).toBe("paymoment:presence:user%2Fone");
    expect(redisKeys.oauthAuthorizationRequest("Request_One")).toBe("paymoment:oauth:authorization-request:request_one");
    expect(redisKeys.websocketChannel("A B")).toBe("paymoment:ws:user:a%20b");
    expect(redisKeys.websocketBroadcastChannel()).toBe("paymoment:ws:broadcast");
  });

  test("stores and replays final idempotency state", async () => {
    const client = inMemoryIdempotencyRedis();
    const first = await beginIdempotentRequest("post.create", "user-1", "request-1", 60, client);
    expect(first.acquired).toBe(true);
    await completeIdempotentRequest(first.redisKey, 201, { id: "post-1" }, 60, client);
    const replay = await beginIdempotentRequest("post.create", "user-1", "request-1", 60, client);
    expect(replay.acquired).toBe(false);
    expect(replay.record).toMatchObject({ status: "completed", statusCode: 201, response: { id: "post-1" } });
  });

  test("maps the atomic fixed-window result", async () => {
    const calls: unknown[][] = [];
    const client: RateLimitRedis = {
      async eval(...args) {
        calls.push(args);
        return [3, 59_100];
      },
    };
    const result = await consumeRateLimit("post.create", "user-1", 5, 60, client);
    expect(result).toEqual({ allowed: true, limit: 5, remaining: 2, retryAfterSeconds: 60 });
    expect(String(calls[0]?.[0])).toContain("PEXPIRE");
  });
});
