import { describe, expect, test } from "bun:test";
import {
  consumePendingAuthorizationRequest,
  createPendingAuthorizationRequest,
  getPendingAuthorizationRequest,
  type OAuthRequestRedis,
} from "./mcp.oauth-request";

function inMemoryRedis(): OAuthRequestRedis {
  const records = new Map<string, string>();
  return {
    async set(key, value, _expiryMode, _ttlSeconds, mode) {
      if (mode === "NX" && records.has(key)) return null;
      records.set(key, value);
      return "OK";
    },
    async get(key) {
      return records.get(key) ?? null;
    },
    async call(_command, key) {
      const value = records.get(key) ?? null;
      records.delete(key);
      return value;
    },
  };
}

describe("MCP pending authorization requests", () => {
  test("stores a request and consumes it exactly once", async () => {
    const redis = inMemoryRedis();
    const request = {
      response_type: "code" as const,
      client_id: "mcp_client",
      redirect_uri: "https://chatgpt.com/connector/oauth/callback",
      code_challenge: "a".repeat(43),
      code_challenge_method: "S256" as const,
      scope: "paymoment.read paymoment.write",
      state: "chatgpt-state",
      resource: "https://mcp.paymom3nts.xyz/mcp",
    };

    const pending = await createPendingAuthorizationRequest(request, redis);
    expect(pending.requestId.length).toBeGreaterThanOrEqual(20);
    expect(await getPendingAuthorizationRequest(pending.requestId, redis)).toEqual(request);
    expect(await consumePendingAuthorizationRequest(pending.requestId, redis)).toEqual(request);
    expect(await consumePendingAuthorizationRequest(pending.requestId, redis)).toBeNull();
  });
});
