import { Hono } from "hono";
import type { Context } from "hono";
import { assertAuthConfigured, config } from "../../config";
import { success } from "../../lib/responses";
import { AppError } from "../../lib/errors";
import { enforceRateLimit } from "../../lib/rate-limit";
import { consumeOauthAttempt, createOauthAttempt } from "./oauth-attempt";
import {
  clearAuthCookies,
  clearOauthStateCookie,
  hashPrivateValue,
  oauthStateCookie,
  setOauthStateCookie,
  setSessionCookie,
} from "./session";
import { currentSession, establishGoogleSession, revokeCurrentSession } from "./auth.service";

const auth = new Hono();
const googleUserInfo = "https://openidconnect.googleapis.com/v1/userinfo";

function errorRedirect(c: Context, reason: string) {
  return c.redirect(`${config().frontendUrl}/login?error=${encodeURIComponent(reason)}`);
}

export function oauthIpIdentity(c: Context) {
  const forwarded = c.req.header("x-forwarded-for")?.split(",").at(-1)?.trim();
  return hashPrivateValue(forwarded || c.req.header("cf-connecting-ip") || c.req.header("x-real-ip") || "unknown");
}

auth.get("/google", async (c) => {
  await enforceRateLimit(c, "auth.google.start", oauthIpIdentity(c), 30, 60 * 60);
  const authConfig = assertAuthConfigured();
  const attempt = await createOauthAttempt(c.req.query("next"));
  const params = new URLSearchParams({
    client_id: authConfig.googleClientId,
    redirect_uri: authConfig.redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state: attempt.state,
    code_challenge: attempt.codeChallenge,
    code_challenge_method: "S256",
    access_type: "online",
    prompt: "select_account",
  });
  setOauthStateCookie(c, attempt.state);
  return c.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

auth.get("/google/callback", async (c) => {
  await enforceRateLimit(c, "auth.google.callback", oauthIpIdentity(c), 60, 60 * 60);
  const authConfig = assertAuthConfigured();
  const code = c.req.query("code");
  const state = c.req.query("state");
  const storedState = oauthStateCookie(c);
  clearOauthStateCookie(c);
  if (c.req.query("error")) return errorRedirect(c, "google_sign_in_cancelled");
  if (!code || !state || !storedState || state !== storedState) return errorRedirect(c, "invalid_oauth_state");

  const attempt = await consumeOauthAttempt(state);
  if (!attempt) return errorRedirect(c, "expired_oauth_attempt");

  try {
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: authConfig.googleClientId,
        client_secret: authConfig.googleClientSecret,
        redirect_uri: authConfig.redirectUri,
        grant_type: "authorization_code",
        code_verifier: attempt.verifier,
      }),
    });
    if (!tokenResponse.ok) return errorRedirect(c, "google_token_exchange_failed");
    const tokens = await tokenResponse.json() as { access_token?: string };
    if (!tokens.access_token) return errorRedirect(c, "google_access_token_missing");

    const profileResponse = await fetch(googleUserInfo, { headers: { Authorization: `Bearer ${tokens.access_token}` } });
    if (!profileResponse.ok) return errorRedirect(c, "google_profile_fetch_failed");
    const profile = await profileResponse.json() as {
      sub?: string;
      email?: string;
      name?: string;
      picture?: string;
      email_verified?: boolean;
    };
    if (!profile.sub || !profile.email) return errorRedirect(c, "google_profile_incomplete");

    const rawSession = await establishGoogleSession(c, {
      sub: profile.sub,
      email: profile.email,
      emailVerified: Boolean(profile.email_verified),
      name: profile.name ?? profile.email.split("@")[0] ?? "PayMoment user",
      picture: profile.picture ?? null,
    });
    setSessionCookie(c, rawSession);
    return c.redirect(new URL(attempt.returnPath, authConfig.frontendUrl).toString());
  } catch (error) {
    if (error instanceof AppError && error.code === "FORBIDDEN") return errorRedirect(c, "verified_google_email_required");
    console.error(JSON.stringify({ level: "error", message: "Google OAuth callback failed.", request_id: c.get("requestId") }));
    return errorRedirect(c, "google_sign_in_failed");
  }
});

auth.get("/session", async (c) => {
  const session = await currentSession(c);
  if (!session) throw new AppError(401, "UNAUTHENTICATED", "Authentication is required.");
  return success(c, { user: session.user });
});

auth.post("/logout", async (c) => {
  await revokeCurrentSession(c);
  clearAuthCookies(c);
  return success(c, { logged_out: true as const });
});

export { auth };
