import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { getCookie, setCookie } from "hono/cookie";
import type { Context } from "hono";
import { config } from "../../config";

export const SESSION_COOKIE = "paymoment_session";
export const STATE_COOKIE = "paymoment_oauth_state";
export const VERIFIER_COOKIE = "paymoment_oauth_verifier";

export type AuthUser = { id: string; email: string; name: string; avatar?: string; verified: boolean };

function encode(value: string) { return Buffer.from(value).toString("base64url"); }
function decode(value: string) { return Buffer.from(value, "base64url").toString("utf8"); }
function signature(value: string) { return createHmac("sha256", config().authSecret).update(value).digest("base64url"); }

export function createSession(user: AuthUser) {
  const encoded = encode(JSON.stringify({ ...user, expiresAt: Date.now() + 1000 * 60 * 60 * 24 * 7 }));
  return `${encoded}.${signature(encoded)}`;
}

export function readSession(value?: string): AuthUser | null {
  try {
    if (!value) return null;
    const [encoded, received] = value.split(".");
    const expected = signature(encoded);
    if (!received || received.length !== expected.length || !timingSafeEqual(Buffer.from(received), Buffer.from(expected))) return null;
    const payload = JSON.parse(decode(encoded)) as AuthUser & { expiresAt: number };
    return payload.expiresAt > Date.now() ? payload : null;
  } catch { return null; }
}

const baseCookie = (secure: boolean) => ({ httpOnly: true, sameSite: "Lax" as const, secure, path: "/" });

export function setOauthCookies(c: Context, state: string, verifier: string) {
  const options = { ...baseCookie(config().isProduction), maxAge: 600 };
  setCookie(c, STATE_COOKIE, state, options);
  setCookie(c, VERIFIER_COOKIE, verifier, options);
}

export function setSessionCookie(c: Context, user: AuthUser) {
  setCookie(c, SESSION_COOKIE, createSession(user), { ...baseCookie(config().isProduction), maxAge: 60 * 60 * 24 * 7 });
}

export function clearAuthCookies(c: Context) {
  for (const name of [SESSION_COOKIE, STATE_COOKIE, VERIFIER_COOKIE]) setCookie(c, name, "", { ...baseCookie(config().isProduction), maxAge: 0 });
}

export function createVerifier() { return randomBytes(32).toString("base64url"); }
export function createState() { return randomBytes(24).toString("base64url"); }
export function challenge(verifier: string) { return createHash("sha256").update(verifier).digest("base64url"); }
export function sessionFrom(c: Context) { return readSession(getCookie(c, SESSION_COOKIE)); }
