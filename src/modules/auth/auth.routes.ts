import { Hono } from "hono";
import type { Context } from "hono";
import { config } from "../../config";
import { challenge, clearAuthCookies, createState, createVerifier, setOauthCookies, setSessionCookie, sessionFrom, STATE_COOKIE, VERIFIER_COOKIE } from "./session";
import { getCookie } from "hono/cookie";

const auth = new Hono();
const googleUserInfo = "https://openidconnect.googleapis.com/v1/userinfo";

function errorRedirect(c: Context, reason: string) {
  return c.redirect(`${config().frontendUrl}/login?error=${encodeURIComponent(reason)}`);
}

auth.get("/google", (c) => {
  const state = createState();
  const verifier = createVerifier();
  const params = new URLSearchParams({ client_id: config().googleClientId, redirect_uri: config().redirectUri, response_type: "code", scope: "openid email profile", state, code_challenge: challenge(verifier), code_challenge_method: "S256", access_type: "online", prompt: "select_account" });
  setOauthCookies(c, state, verifier);
  return c.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

auth.get("/google/callback", async (c) => {
  const code = c.req.query("code");
  const state = c.req.query("state");
  const storedState = getCookie(c, STATE_COOKIE);
  const verifier = getCookie(c, VERIFIER_COOKIE);
  if (c.req.query("error")) return errorRedirect(c, "google_cancelled");
  if (!code || !state || !storedState || state !== storedState || !verifier) return errorRedirect(c, "invalid_oauth_state");

  try {
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code, client_id: config().googleClientId, client_secret: config().googleClientSecret, redirect_uri: config().redirectUri, grant_type: "authorization_code", code_verifier: verifier }) });
    if (!tokenResponse.ok) return errorRedirect(c, "token_exchange_failed");
    const tokens = await tokenResponse.json() as { access_token?: string };
    if (!tokens.access_token) return errorRedirect(c, "missing_access_token");
    const profileResponse = await fetch(googleUserInfo, { headers: { Authorization: `Bearer ${tokens.access_token}` } });
    if (!profileResponse.ok) return errorRedirect(c, "profile_fetch_failed");
    const profile = await profileResponse.json() as { sub?: string; email?: string; name?: string; picture?: string; email_verified?: boolean };
    if (!profile.sub || !profile.email) return errorRedirect(c, "missing_google_profile");
    setSessionCookie(c, { id: profile.sub, email: profile.email, name: profile.name ?? profile.email.split("@")[0], avatar: profile.picture, verified: Boolean(profile.email_verified) });
    return c.redirect(config().frontendUrl);
  } catch (error) {
    console.error("Google OAuth callback failed", error);
    return errorRedirect(c, "oauth_failed");
  }
});

auth.get("/session", (c) => {
  const user = sessionFrom(c);
  return c.json({ user }, user ? 200 : 401);
});

auth.post("/logout", (c) => {
  clearAuthCookies(c);
  return c.json({ ok: true });
});

export { auth };
