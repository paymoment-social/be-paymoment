import { describe, expect, test } from "bun:test";
import { apiErrorSchema } from "./contracts/common";
import { createApp } from "./app";

describe("PayMoment API foundation", () => {
  const app = createApp();

  test("returns a request-scoped health envelope", async () => {
    const response = await app.request("/health", { headers: { "x-request-id": "req_test_12345" } });
    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBe("req_test_12345");
    expect(await response.json()).toEqual({
      data: { ok: true, service: "paymoment-api", runtime: "bun" },
      meta: { request_id: "req_test_12345" },
    });
  });

  test("returns the standard not-found error", async () => {
    const response = await app.request("/missing");
    expect(response.status).toBe(404);
    expect(apiErrorSchema.parse(await response.json()).error.code).toBe("NOT_FOUND");
  });

  test("returns the standard unauthenticated error", async () => {
    const response = await app.request("/api/v1/auth/session");
    expect(response.status).toBe(401);
    expect(apiErrorSchema.parse(await response.json()).error.code).toBe("UNAUTHENTICATED");
  });

  test("allows public MCP preflight headers without cookies", async () => {
    const response = await app.request("/mcp", {
      method: "OPTIONS",
      headers: {
        Origin: "https://claude.ai",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "authorization,mcp-protocol-version,content-type",
      },
    });
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("access-control-allow-headers")?.toLowerCase()).toContain("authorization");
  });

  test("advertises OAuth protected-resource metadata when MCP authentication is required", async () => {
    const response = await app.request("/mcp", { method: "POST" });
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain('resource_metadata="http://localhost:8787/.well-known/oauth-protected-resource/mcp"');
    expect(response.headers.get("www-authenticate")).toContain('scope="paymoment.read paymoment.write"');
  });

  test("publishes complete remote MCP OAuth discovery metadata", async () => {
    const response = await app.request("/.well-known/oauth-authorization-server");
    const metadata = await response.json() as Record<string, unknown>;
    expect(response.status).toBe(200);
    const issuer = String(metadata.issuer);
    expect(metadata.authorization_endpoint).toBe(`${issuer}/authorize`);
    expect(metadata.token_endpoint).toBe(`${issuer}/token`);
    expect(metadata.revocation_endpoint).toBe(`${issuer}/revoke`);
    expect(metadata.scopes_supported).toEqual(["paymoment.read", "paymoment.write"]);
  });

  test("returns readiness state from infrastructure checks", async () => {
    const readyApp = createApp({
      readiness: async () => ({ ok: true, checks: { postgres: "up", redis: "up" } }),
    });
    const response = await readyApp.request("/ready");
    expect(response.status).toBe(200);
    expect((await response.json()).data.ok).toBe(true);
  });

  test("returns an English service unavailable error when a dependency is down", async () => {
    const unavailableApp = createApp({
      readiness: async () => ({ ok: false, checks: { postgres: "up", redis: "down" } }),
    });
    const response = await unavailableApp.request("/ready");
    const payload = await response.json();
    expect(response.status).toBe(503);
    expect(payload.error.code).toBe("SERVICE_UNAVAILABLE");
    expect(payload.error.message).toBe("One or more required services are unavailable.");
    expect(payload.checks.redis).toBe("down");
  });
});
