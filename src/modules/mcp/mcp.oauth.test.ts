import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { hashPrivateValue } from "../auth/session";
import { connectionDurationSchema, connectionExpiry, mcpRedirectUriSchema, oauthIpIdentity } from "./mcp.oauth";

describe("MCP OAuth rate-limit identity", () => {
  test("uses the proxy-appended final forwarding hop", async () => {
    const app = new Hono().get("/", (c) => c.json({ identity: oauthIpIdentity(c) }));
    const response = await app.request("/", { headers: { "x-forwarded-for": "198.51.100.10, 203.0.113.42" } });
    const payload = await response.json() as { identity: string };
    expect(payload.identity).toBe(hashPrivateValue("203.0.113.42"));
    expect(payload.identity).not.toBe(hashPrivateValue("198.51.100.10"));
  });
});

describe("MCP OAuth redirect URI validation", () => {
  test("accepts HTTPS and local desktop callback URIs only", () => {
    expect(mcpRedirectUriSchema.safeParse("https://chatgpt.com/mcp/callback").success).toBeTrue();
    expect(mcpRedirectUriSchema.safeParse("http://127.0.0.1:45678/callback").success).toBeTrue();
    expect(mcpRedirectUriSchema.safeParse("http://localhost:45678/callback").success).toBeTrue();
    expect(mcpRedirectUriSchema.safeParse("http://example.com/callback").success).toBeFalse();
  });
});

describe("MCP connection expiration", () => {
  test("accepts only supported connection durations", () => {
    for (const duration of ["never", 1, 7, 30, 90]) expect(connectionDurationSchema.safeParse(duration).success).toBeTrue();
    expect(connectionDurationSchema.safeParse(365).success).toBeFalse();
  });

  test("calculates an absolute expiration date", () => {
    const now = new Date("2026-08-13T00:00:00.000Z");
    expect(connectionExpiry(7, now)?.toISOString()).toBe("2026-08-20T00:00:00.000Z");
    expect(connectionExpiry("never", now)).toBeNull();
  });
});
