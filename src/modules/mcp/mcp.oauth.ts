import { createHash, randomUUID } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { z } from "zod";
import { config } from "../../config";
import { getDb } from "../../db/client";
import { mcpAccessTokens, mcpAuthorizationCodes, mcpClients, mcpConsents, mcpRefreshTokens } from "../../db/schema";
import { AppError } from "../../lib/errors";
import { enforceRateLimit } from "../../lib/rate-limit";
import { parseJson, parseQuery } from "../../lib/validation";
import { requireSession } from "../auth/auth.service";
import { hashPrivateValue, hashToken, randomToken } from "../auth/session";

const scopes = ["paymoment.read", "paymoment.write"];
export const mcpRedirectUriSchema = z.url().refine((value) => {
  const url = new URL(value);
  return url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(url.hostname));
}, "Redirect URIs must use HTTPS unless they target a local loopback address.");
export const registerSchema = z.object({ client_name: z.string().trim().min(1).max(120), redirect_uris: z.array(mcpRedirectUriSchema).min(1).max(10), token_endpoint_auth_method: z.literal("none").optional() });
export const authorizeSchema = z.object({ response_type: z.literal("code"), client_id: z.string().min(1), redirect_uri: mcpRedirectUriSchema, code_challenge: z.string().min(43).max(128), code_challenge_method: z.literal("S256"), scope: z.string().optional(), state: z.string().max(2048).optional() });
const authorizeConsentSchema = authorizeSchema.extend({ decision: z.enum(["approve", "deny"]) });
const tokenSchema = z.discriminatedUnion("grant_type", [z.object({ grant_type: z.literal("authorization_code"), code: z.string().min(1), redirect_uri: z.url(), client_id: z.string().min(1), code_verifier: z.string().min(43).max(128) }), z.object({ grant_type: z.literal("refresh_token"), refresh_token: z.string().min(1), client_id: z.string().min(1) })]);
const revokeSchema = z.object({ token: z.string().min(1), client_id: z.string().min(1), token_type_hint: z.enum(["access_token", "refresh_token"]).optional() });
const sha256 = (value: string) => createHash("sha256").update(value).digest("base64url");
const normalizedScopes = (scope?: string) => [...new Set((scope ?? "paymoment.read paymoment.write").split(/\s+/).filter(Boolean))];
export const oauthIpIdentity = (c: Context) => hashPrivateValue(c.req.header("x-forwarded-for")?.split(",").at(-1)?.trim() || c.req.header("cf-connecting-ip") || c.req.header("x-real-ip") || "unknown");

async function parseOAuthBody<T extends z.ZodType>(c: Context, schema: T): Promise<z.output<T>> {
  const contentType = c.req.header("content-type") ?? "";
  const raw = contentType.includes("application/x-www-form-urlencoded") ? await c.req.parseBody() : await c.req.json();
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new AppError(422, "VALIDATION_ERROR", "The OAuth request is invalid.");
  return parsed.data;
}

async function issueTokens(clientId: string, userId: string, grantedScopes: string[]) {
  const accessToken = randomToken(32); const refreshToken = randomToken(32); const expiresAt = new Date(Date.now() + 60 * 60 * 1_000);
  const [access] = await getDb().insert(mcpAccessTokens).values({ tokenHash: hashToken(accessToken), clientId, userId, scopes: grantedScopes, expiresAt }).returning();
  await getDb().insert(mcpRefreshTokens).values({ tokenHash: hashToken(refreshToken), accessTokenId: access!.id, familyId: randomUUID(), expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1_000) });
  return { access_token: accessToken, token_type: "Bearer", expires_in: 3600, refresh_token: refreshToken, scope: grantedScopes.join(" ") };
}

function escapeHtml(value: string) { return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!); }
async function validateAuthorization(input: z.infer<typeof authorizeSchema>) {
  const requestedScopes = normalizedScopes(input.scope);
  if (requestedScopes.some((scope) => !scopes.includes(scope))) throw new AppError(422, "VALIDATION_ERROR", "One or more requested OAuth scopes are invalid.");
  const [client] = await getDb().select().from(mcpClients).where(and(eq(mcpClients.clientId, input.client_id), eq(mcpClients.active, true))).limit(1);
  if (!client || !client.redirectUris.includes(input.redirect_uri)) throw new AppError(400, "VALIDATION_ERROR", "The OAuth client or redirect URI is invalid.");
  return { client, requestedScopes };
}
function oauthRedirect(input: z.infer<typeof authorizeSchema>, params: Record<string, string>) {
  const redirect = new URL(input.redirect_uri);
  for (const [key, value] of Object.entries(params)) redirect.searchParams.set(key, value);
  if (input.state) redirect.searchParams.set("state", input.state);
  return redirect.toString();
}
async function grantAuthorization(userId: string, input: z.infer<typeof authorizeSchema>) {
  const { client, requestedScopes } = await validateAuthorization(input);
  const code = randomToken(32);
  await getDb().transaction(async (tx) => {
    await tx.insert(mcpConsents).values({ userId, clientId: client.id, scopes: requestedScopes }).onConflictDoUpdate({ target: [mcpConsents.userId, mcpConsents.clientId], set: { scopes: requestedScopes, revokedAt: null, updatedAt: new Date() } });
    await tx.insert(mcpAuthorizationCodes).values({ codeHash: hashToken(code), clientId: client.id, userId, redirectUri: input.redirect_uri, scopes: requestedScopes, codeChallenge: input.code_challenge, codeChallengeMethod: "S256", expiresAt: new Date(Date.now() + 5 * 60 * 1_000) });
  });
  return oauthRedirect(input, { code });
}

export const mcpOauthRoutes = new Hono();
mcpOauthRoutes.post("/register", async (c) => { await enforceRateLimit(c, "mcp.oauth.register", oauthIpIdentity(c), 20, 60 * 60); const input = await parseJson(c, registerSchema); const clientId = `mcp_${randomToken(18)}`; const [client] = await getDb().insert(mcpClients).values({ clientId, clientType: "public", name: input.client_name, redirectUris: input.redirect_uris, scopes }).returning(); return c.json({ client_id: client!.clientId, client_name: client!.name, redirect_uris: client!.redirectUris, token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] }, 201); });
mcpOauthRoutes.get("/authorize", async (c) => {
  await requireSession(c);
  const input = parseQuery(c, authorizeSchema);
  const { client, requestedScopes } = await validateAuthorization(input);
  const hidden = Object.entries(input).filter(([, value]) => value !== undefined).map(([key, value]) => `<input type="hidden" name="${escapeHtml(key)}" value="${escapeHtml(String(value))}">`).join("");
  const permissionLabels: Record<string, { title: string; description: string; icon: string }> = {
    "paymoment.read": { title: "Read your PayMoment data", description: "View your profile, Moments, and connected activity.", icon: "◌" },
    "paymoment.write": { title: "Create on your behalf", description: "Publish Moments only when you approve the action.", icon: "✦" },
  };
  const permissionRows = requestedScopes.map((scope) => {
    const permission = permissionLabels[scope] ?? { title: scope, description: "Access requested by this connector.", icon: "•" };
    return `<li class="permission" data-scope="${escapeHtml(scope)}"><span class="permission-icon" aria-hidden="true">${permission.icon}</span><span class="permission-copy"><strong>${escapeHtml(permission.title)}</strong><small>${escapeHtml(permission.description)}</small></span></li>`;
  }).join("");
  return c.html(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#0b0b10"><title>Connect ${escapeHtml(client.name)} · PayMoment</title><style>
  :root{color-scheme:dark;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#08090a;color:#f5f5f7}*{box-sizing:border-box}body{min-height:100vh;margin:0;padding:18px;display:grid;place-items:center;background:radial-gradient(circle at 50% -12%,#8056e83d 0,transparent 42%),#08090a}main{width:min(100%,448px);overflow:hidden;border:1px solid #292a2f;border-radius:18px;background:#101113;box-shadow:0 24px 72px #0009}.brand{display:flex;align-items:center;gap:9px;padding:16px 18px}.brand-mark{display:grid;place-items:center;width:30px;height:30px;border-radius:9px;background:linear-gradient(135deg,#b8a2ff,#8056e8);color:#17121f;font-size:18px;font-weight:850;letter-spacing:-.08em}.brand-name{font-size:16px;font-weight:760;letter-spacing:-.035em}.brand-sub{margin-left:auto;border:1px solid #292a2f;border-radius:999px;padding:5px 8px;color:#a6a6ad;font-size:9px;font-weight:750;letter-spacing:.1em;text-transform:uppercase}.hero{padding:18px;border-top:1px solid #292a2f;border-bottom:1px solid #292a2f;background:linear-gradient(145deg,#171423,#101113 72%)}.eyebrow{margin:0 0 7px;color:#b8a2ff;font-size:11px;font-weight:750;letter-spacing:.1em;text-transform:uppercase}.hero h1{margin:0;font-size:25px;line-height:1.1;letter-spacing:-.06em}.hero p{margin:9px 0 0;color:#a6a6ad;font-size:13px;line-height:1.5}.body{padding:18px}.section-title{margin:0 0 9px;font-size:11px;font-weight:750;letter-spacing:.09em;text-transform:uppercase;color:#a6a6ad}.permissions{display:grid;gap:7px;margin:0;padding:0;list-style:none}.permission{display:flex;gap:10px;align-items:flex-start;padding:10px;border:1px solid #292a2f;border-radius:12px;background:#17181b}.permission-icon{display:grid;place-items:center;flex:none;width:28px;height:28px;border-radius:8px;background:#8056e81f;color:#b8a2ff;font-size:0}.permission-icon svg{display:none}.permission-icon::before{content:"";display:block;width:15px;height:15px;background:center/contain no-repeat}.permission[data-scope="paymoment.read"] .permission-icon{background:#b8a2ff1f}.permission[data-scope="paymoment.read"] .permission-icon::before{background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23b8a2ff' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M3 12s3.2-5 9-5 9 5 9 5-3.2 5-9 5-9-5-9-5Z'/%3E%3Ccircle cx='12' cy='12' r='2.25'/%3E%3C/svg%3E")}.permission[data-scope="paymoment.write"] .permission-icon{background:#8056e81f}.permission[data-scope="paymoment.write"] .permission-icon::before{background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23b8a2ff' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m13.5 6.5 4 4M5 19l3.7-.8L18.8 8.1a2.1 2.1 0 0 0-3-3L5.7 15.2 5 19Z'/%3E%3Cpath d='M14 19h5'/%3E%3C/svg%3E")}.permission-copy{min-width:0}.permission strong{display:block;font-size:12px;line-height:1.35}.permission small{display:block;margin-top:3px;color:#a6a6ad;font-size:11px;line-height:1.35}.secure{display:flex;align-items:center;gap:8px;margin:15px 0 17px;color:#53d39a;font-size:11px}.secure-dot{width:7px;height:7px;border-radius:50%;background:#53d39a;box-shadow:0 0 0 4px #53d39a1a}.actions{display:grid;gap:7px}.actions button{width:100%;min-height:42px;border-radius:11px;font:inherit;font-size:13px;font-weight:750;cursor:pointer;transition:filter .15s,background .15s,border-color .15s}.actions button:hover{filter:brightness(1.08)}.actions button:focus-visible{outline:2px solid #b8a2ff;outline-offset:2px}.allow{border:0;background:linear-gradient(100deg,#b8a2ff,#8056e8);color:#100c17;box-shadow:0 8px 22px #8056e83d}.deny{border:1px solid #292a2f;background:#17181b;color:#d6d2dc}.fineprint{margin:13px 0 0;text-align:center;color:#777980;font-size:10px;line-height:1.4}@media(max-width:480px){body{padding:10px}main{border-radius:16px}.brand,.hero,.body{padding-left:15px;padding-right:15px}}
  </style></head><body><main><div class="brand"><span class="brand-mark" aria-hidden="true">P</span><span class="brand-name">PayMoment</span><span class="brand-sub">OAuth</span></div><section class="hero"><p class="eyebrow">Secure connection</p><h1>Connect ${escapeHtml(client.name)}</h1><p>This connector wants to access your PayMoment account. Review the permissions before continuing.</p></section><section class="body"><h2 class="section-title">Requested access</h2><ul class="permissions">${permissionRows}</ul><div class="secure"><span class="secure-dot" aria-hidden="true"></span>Encrypted connection · You can revoke access anytime</div><form method="post" action="/oauth/authorize" class="actions">${hidden}<button class="allow" name="decision" value="approve" type="submit">Allow access</button><button class="deny" name="decision" value="deny" type="submit">Cancel</button></form><p class="fineprint">By continuing, you allow ${escapeHtml(client.name)} to use PayMoment within the permissions above.</p></section></main></body></html>`);
});
mcpOauthRoutes.post("/authorize", async (c) => {
  const session = await requireSession(c);
  const input = await parseOAuthBody(c, authorizeConsentSchema);
  const request = authorizeSchema.parse(input);
  await validateAuthorization(request);
  if (input.decision === "deny") return c.redirect(oauthRedirect(request, { error: "access_denied", error_description: "The user denied authorization." }));
  return c.redirect(await grantAuthorization(session.user.id, request));
});
mcpOauthRoutes.post("/token", async (c) => { await enforceRateLimit(c, "mcp.oauth.token", oauthIpIdentity(c), 300, 60 * 60); const input = await parseOAuthBody(c, tokenSchema); if (input.grant_type === "authorization_code") { const [client] = await getDb().select().from(mcpClients).where(and(eq(mcpClients.clientId, input.client_id), eq(mcpClients.active, true))).limit(1); if (!client) throw new AppError(401, "UNAUTHENTICATED", "The OAuth client is invalid."); const [code] = await getDb().update(mcpAuthorizationCodes).set({ consumedAt: new Date() }).where(and(eq(mcpAuthorizationCodes.codeHash, hashToken(input.code)), eq(mcpAuthorizationCodes.clientId, client.id), eq(mcpAuthorizationCodes.redirectUri, input.redirect_uri), isNull(mcpAuthorizationCodes.consumedAt), gt(mcpAuthorizationCodes.expiresAt, new Date()))).returning(); if (!code || sha256(input.code_verifier) !== code.codeChallenge) throw new AppError(400, "VALIDATION_ERROR", "The authorization code or PKCE verifier is invalid."); return c.json(await issueTokens(client.id, code.userId, code.scopes)); }
  const [client] = await getDb().select().from(mcpClients).where(and(eq(mcpClients.clientId, input.client_id), eq(mcpClients.active, true))).limit(1); if (!client) throw new AppError(401, "UNAUTHENTICATED", "The OAuth client is invalid."); const [refresh] = await getDb().select().from(mcpRefreshTokens).where(and(eq(mcpRefreshTokens.tokenHash, hashToken(input.refresh_token)), isNull(mcpRefreshTokens.revokedAt), isNull(mcpRefreshTokens.rotatedAt), gt(mcpRefreshTokens.expiresAt, new Date()))).limit(1); if (!refresh) throw new AppError(401, "UNAUTHENTICATED", "The refresh token is invalid or expired."); const [access] = await getDb().select().from(mcpAccessTokens).where(and(eq(mcpAccessTokens.id, refresh.accessTokenId), eq(mcpAccessTokens.clientId, client.id), isNull(mcpAccessTokens.revokedAt))).limit(1); if (!access) throw new AppError(401, "UNAUTHENTICATED", "The refresh token is invalid."); await getDb().update(mcpRefreshTokens).set({ rotatedAt: new Date() }).where(eq(mcpRefreshTokens.id, refresh.id)); await getDb().update(mcpAccessTokens).set({ revokedAt: new Date() }).where(eq(mcpAccessTokens.id, access.id)); return c.json(await issueTokens(client.id, access.userId, access.scopes)); });
mcpOauthRoutes.post("/revoke", async (c) => {
  await enforceRateLimit(c, "mcp.oauth.revoke", oauthIpIdentity(c), 300, 60 * 60);
  const input = await parseOAuthBody(c, revokeSchema);
  const [client] = await getDb().select({ id: mcpClients.id }).from(mcpClients).where(and(eq(mcpClients.clientId, input.client_id), eq(mcpClients.active, true))).limit(1);
  if (!client) return c.body(null, 200);
  const tokenHash = hashToken(input.token);
  await getDb().transaction(async (tx) => {
    const [access] = await tx.select({ id: mcpAccessTokens.id }).from(mcpAccessTokens).where(and(eq(mcpAccessTokens.tokenHash, tokenHash), eq(mcpAccessTokens.clientId, client.id))).limit(1);
    if (access) {
      await tx.update(mcpAccessTokens).set({ revokedAt: new Date() }).where(eq(mcpAccessTokens.id, access.id));
      await tx.update(mcpRefreshTokens).set({ revokedAt: new Date() }).where(eq(mcpRefreshTokens.accessTokenId, access.id));
      return;
    }
    const [refresh] = await tx.select({ id: mcpRefreshTokens.id, accessTokenId: mcpRefreshTokens.accessTokenId }).from(mcpRefreshTokens).innerJoin(mcpAccessTokens, eq(mcpAccessTokens.id, mcpRefreshTokens.accessTokenId)).where(and(eq(mcpRefreshTokens.tokenHash, tokenHash), eq(mcpAccessTokens.clientId, client.id))).limit(1);
    if (refresh) {
      await tx.update(mcpRefreshTokens).set({ revokedAt: new Date() }).where(eq(mcpRefreshTokens.id, refresh.id));
      await tx.update(mcpAccessTokens).set({ revokedAt: new Date() }).where(eq(mcpAccessTokens.id, refresh.accessTokenId));
    }
  });
  return c.body(null, 200);
});
mcpOauthRoutes.get("/.well-known/oauth-authorization-server", (c) => { const issuer = `${config().mcpIssuerUrl.replace(/\/$/, "")}/oauth`; return c.json({ issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, revocation_endpoint: `${issuer}/revoke`, registration_endpoint: `${issuer}/register`, response_types_supported: ["code"], grant_types_supported: ["authorization_code", "refresh_token"], code_challenge_methods_supported: ["S256"], token_endpoint_auth_methods_supported: ["none"], scopes_supported: scopes }); });
