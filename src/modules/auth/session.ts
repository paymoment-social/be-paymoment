import { createHash, createHmac, randomBytes } from "node:crypto";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Context } from "hono";
import { config } from "../../config";

export const SESSION_COOKIE = "paymoment_session";
export const STATE_COOKIE = "paymoment_oauth_state";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

const baseCookie = () => ({
  httpOnly: true,
  sameSite: "Lax" as const,
  secure: config().isProduction,
  path: "/",
  ...(config().isProduction && config().authCookieDomain ? { domain: config().authCookieDomain } : {}),
});

export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

export function hashToken(value: string) {
  return createHash("sha256").update(value).digest("base64url");
}

export function hashPrivateValue(value: string) {
  return createHmac("sha256", config().authSecret).update(value).digest("base64url");
}

export function setOauthStateCookie(c: Context, state: string) {
  setCookie(c, STATE_COOKIE, state, { ...baseCookie(), maxAge: 600 });
}

export function oauthStateCookie(c: Context) {
  return getCookie(c, STATE_COOKIE);
}

export function clearOauthStateCookie(c: Context) {
  deleteCookie(c, STATE_COOKIE, baseCookie());
}

export function setSessionCookie(c: Context, rawToken: string) {
  setCookie(c, SESSION_COOKIE, rawToken, { ...baseCookie(), maxAge: SESSION_TTL_SECONDS });
}

export function sessionCookie(c: Context) {
  return getCookie(c, SESSION_COOKIE);
}

export function clearSessionCookie(c: Context) {
  deleteCookie(c, SESSION_COOKIE, baseCookie());
}

export function clearAuthCookies(c: Context) {
  clearSessionCookie(c);
  clearOauthStateCookie(c);
}

export function createVerifier() { return randomToken(32); }
export function createState() { return randomToken(24); }
export function challenge(verifier: string) { return createHash("sha256").update(verifier).digest("base64url"); }
