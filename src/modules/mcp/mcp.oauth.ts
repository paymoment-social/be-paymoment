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
  return c.html(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Authorize PayMoment MCP</title><style>body{font-family:system-ui,sans-serif;background:#101014;color:#f5f5f7;margin:0;padding:2rem}main{max-width:34rem;margin:8vh auto;padding:2rem;border:1px solid #363640;border-radius:1rem;background:#19191f}button{font:inherit;padding:.75rem 1rem;border-radius:.6rem;border:0;cursor:pointer}button[name=decision][value=approve]{background:#8b5cf6;color:white}.deny{background:transparent;color:#ddd;border:1px solid #555;margin-left:.5rem}li{margin:.5rem 0}</style></head><body><main><h1>Connect ${escapeHtml(client.name)}</h1><p>This MCP client requests permission to access your PayMoment account.</p><h2>Permissions</h2><ul>${requestedScopes.map((scope) => `<li>${escapeHtml(scope)}</li>`).join("")}</ul><form method="post" action="/oauth/authorize">${hidden}<button name="decision" value="approve" type="submit">Allow access</button><button class="deny" name="decision" value="deny" type="submit">Deny</button></form></main></body></html>`);
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
