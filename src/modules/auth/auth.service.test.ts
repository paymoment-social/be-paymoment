import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { hashPrivateValue } from "./session";
import { clientMetadata } from "./auth.service";
import { oauthIpIdentity } from "./auth.routes";

describe("authentication client metadata", () => {
  test("uses the trusted proxy-appended X-Forwarded-For hop", async () => {
    const app = new Hono().get("/", (c) => c.json(clientMetadata(c)));
    const response = await app.request("/", { headers: { "x-forwarded-for": "198.51.100.10, 203.0.113.42", "user-agent": "phase-security-test" } });
    const metadata = await response.json() as { ipHash: string | null; userAgent: string | null };
    expect(metadata.ipHash).toBe(hashPrivateValue("203.0.113.42"));
    expect(metadata.ipHash).not.toBe(hashPrivateValue("198.51.100.10"));
    expect(metadata.userAgent).toBe("phase-security-test");
  });
});

test("Google OAuth rate limiting uses the trusted proxy-appended X-Forwarded-For hop", async () => {
  const app = new Hono().get("/", (c) => c.json({ ipHash: oauthIpIdentity(c) }));
  const response = await app.request("/", { headers: { "x-forwarded-for": "198.51.100.10, 203.0.113.42" } });
  const body = await response.json() as { ipHash: string };
  expect(body.ipHash).toBe(hashPrivateValue("203.0.113.42"));
  expect(body.ipHash).not.toBe(hashPrivateValue("198.51.100.10"));
});
