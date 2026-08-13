import { createHash, randomUUID } from "node:crypto";
import { and, eq, gt, isNull, or } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { z } from "zod";
import { config } from "../../config";
import { getDb } from "../../db/client";
import { mcpAccessTokens, mcpAuthorizationCodes, mcpClients, mcpConsents, mcpRefreshTokens } from "../../db/schema";
import { AppError } from "../../lib/errors";
import { enforceRateLimit } from "../../lib/rate-limit";
import { parseJson, parseQuery } from "../../lib/validation";
import { hashPrivateValue, hashToken, randomToken } from "../auth/session";
import { createPendingAuthorizationRequest } from "./mcp.oauth-request";

const scopes = ["paymoment.read", "paymoment.write"];
const oauthResourceSchema = z.url();

export const mcpRedirectUriSchema = z.url().refine((value) => {
  const url = new URL(value);
  return url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(url.hostname));
}, "Redirect URIs must use HTTPS unless they target a local loopback address.");

export const registerSchema = z.object({
  client_name: z.string().trim().min(1).max(120),
  redirect_uris: z.array(mcpRedirectUriSchema).min(1).max(10),
  token_endpoint_auth_method: z.literal("none").optional(),
});

export const authorizeSchema = z.object({
  response_type: z.literal("code"),
  client_id: z.string().min(1),
  redirect_uri: mcpRedirectUriSchema,
  code_challenge: z.string().min(43).max(128),
  code_challenge_method: z.literal("S256"),
  scope: z.string().optional(),
  state: z.string().max(2048).optional(),
  resource: oauthResourceSchema.optional(),
});

const authorizationCodeTokenSchema = z.object({
  grant_type: z.literal("authorization_code"),
  code: z.string().min(1),
  redirect_uri: z.url(),
  client_id: z.string().min(1),
  code_verifier: z.string().min(43).max(128),
  resource: oauthResourceSchema.optional(),
});

const refreshTokenSchema = z.object({
  grant_type: z.literal("refresh_token"),
  refresh_token: z.string().min(1),
  client_id: z.string().min(1),
  resource: oauthResourceSchema.optional(),
});

const tokenSchema = z.discriminatedUnion("grant_type", [authorizationCodeTokenSchema, refreshTokenSchema]);
const revokeSchema = z.object({ token: z.string().min(1), client_id: z.string().min(1), token_type_hint: z.enum(["access_token", "refresh_token"]).optional() });
export const CONNECTION_DURATIONS = ["never", 1, 7, 30, 90] as const;
export const connectionDurationSchema = z.union([z.literal("never"), z.literal(1), z.literal(7), z.literal(30), z.literal(90)]);
export type ConnectionDuration = z.infer<typeof connectionDurationSchema>;
const sha256 = (value: string) => createHash("sha256").update(value).digest("base64url");
const normalizedScopes = (scope?: string) => [...new Set((scope ?? "paymoment.read paymoment.write").split(/\s+/).filter(Boolean))];
const protectedResource = () => `${config().mcpIssuerUrl.replace(/\/$/, "")}/mcp`;

export const oauthPermissionLabels: Record<string, { title: string; description: string }> = {
  "paymoment.read": { title: "Read your PayMoment data", description: "View your profile, Moments, messages, notifications, and connected activity." },
  "paymoment.write": { title: "Act on your behalf", description: "Create or update PayMoment content only when you approve the action." },
};

export const oauthIpIdentity = (c: Context) => hashPrivateValue(c.req.header("x-forwarded-for")?.split(",").at(-1)?.trim() || c.req.header("cf-connecting-ip") || c.req.header("x-real-ip") || "unknown");

async function parseOAuthBody<T extends z.ZodType>(c: Context, schema: T): Promise<z.output<T>> {
  const contentType = c.req.header("content-type") ?? "";
  const raw = contentType.includes("application/x-www-form-urlencoded") ? await c.req.parseBody() : await c.req.json();
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new AppError(422, "VALIDATION_ERROR", "The OAuth request is invalid.");
  return parsed.data;
}

function oauthTokenError(c: Context, error: "invalid_client" | "invalid_grant", description: string, status: 400 | 401 = 400) {
  c.header("Cache-Control", "no-store");
  c.header("Pragma", "no-cache");
  return c.json({ error, error_description: description }, status);
}

function validateResource(resource?: string) {
  if (resource && resource.replace(/\/$/, "") !== protectedResource()) {
    throw new AppError(422, "VALIDATION_ERROR", "The requested OAuth resource is invalid.");
  }
}

export function connectionExpiry(duration: ConnectionDuration, now = new Date()) {
  return duration === "never" ? null : new Date(now.getTime() + duration * 24 * 60 * 60 * 1_000);
}

async function issueTokens(clientId: string, userId: string, grantedScopes: string[], connectionExpiresAt: Date | null) {
  const accessToken = randomToken(32);
  const refreshToken = randomToken(32);
  const now = Date.now();
  if (connectionExpiresAt && connectionExpiresAt.getTime() <= now) throw new AppError(401, "UNAUTHENTICATED", "The PayMoment connection has expired.");
  const expiresAt = new Date(connectionExpiresAt ? Math.min(now + 60 * 60 * 1_000, connectionExpiresAt.getTime()) : now + 60 * 60 * 1_000);
  const expiresIn = Math.max(1, Math.floor((expiresAt.getTime() - now) / 1_000));
  const [access] = await getDb().insert(mcpAccessTokens).values({ tokenHash: hashToken(accessToken), clientId, userId, scopes: grantedScopes, expiresAt }).returning();
  await getDb().insert(mcpRefreshTokens).values({ tokenHash: hashToken(refreshToken), accessTokenId: access!.id, familyId: randomUUID(), expiresAt: connectionExpiresAt });
  return { access_token: accessToken, token_type: "Bearer", expires_in: expiresIn, refresh_token: refreshToken, scope: grantedScopes.join(" ") };
}

export async function validateAuthorization(input: z.infer<typeof authorizeSchema>) {
  validateResource(input.resource);
  const requestedScopes = normalizedScopes(input.scope);
  if (requestedScopes.some((scope) => !scopes.includes(scope))) throw new AppError(422, "VALIDATION_ERROR", "One or more requested OAuth scopes are invalid.");
  const [client] = await getDb().select().from(mcpClients).where(and(eq(mcpClients.clientId, input.client_id), eq(mcpClients.active, true))).limit(1);
  if (!client || !client.redirectUris.includes(input.redirect_uri)) throw new AppError(400, "VALIDATION_ERROR", "The OAuth client or redirect URI is invalid.");
  return { client, requestedScopes };
}

export function oauthRedirect(input: z.infer<typeof authorizeSchema>, params: Record<string, string>) {
  const redirect = new URL(input.redirect_uri);
  for (const [key, value] of Object.entries(params)) redirect.searchParams.set(key, value);
  if (input.state) redirect.searchParams.set("state", input.state);
  return redirect.toString();
}

export async function grantAuthorization(userId: string, input: z.infer<typeof authorizeSchema>, duration: ConnectionDuration = "never") {
  const { client, requestedScopes } = await validateAuthorization(input);
  const code = randomToken(32);
  const now = new Date();
  const expiresAt = connectionExpiry(duration, now);
  await getDb().transaction(async (tx) => {
    await tx.insert(mcpConsents).values({ userId, clientId: client.id, scopes: requestedScopes, grantedAt: now, expiresAt }).onConflictDoUpdate({ target: [mcpConsents.userId, mcpConsents.clientId], set: { scopes: requestedScopes, grantedAt: now, expiresAt, revokedAt: null, updatedAt: now } });
    await tx.insert(mcpAuthorizationCodes).values({ codeHash: hashToken(code), clientId: client.id, userId, redirectUri: input.redirect_uri, scopes: requestedScopes, codeChallenge: input.code_challenge, codeChallengeMethod: "S256", expiresAt: new Date(Date.now() + 5 * 60 * 1_000) });
  });
  return oauthRedirect(input, { code });
}

export const mcpOauthRoutes = new Hono();

mcpOauthRoutes.post("/register", async (c) => {
  await enforceRateLimit(c, "mcp.oauth.register", oauthIpIdentity(c), 20, 60 * 60);
  const input = await parseJson(c, registerSchema);
  const clientId = `mcp_${randomToken(18)}`;
  const [client] = await getDb().insert(mcpClients).values({ clientId, clientType: "public", name: input.client_name, redirectUris: input.redirect_uris, scopes }).returning();
  return c.json({ client_id: client!.clientId, client_name: client!.name, redirect_uris: client!.redirectUris, token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] }, 201);
});

mcpOauthRoutes.get("/authorize", async (c) => {
  await enforceRateLimit(c, "mcp.oauth.authorize", oauthIpIdentity(c), 120, 60 * 60);
  const input = parseQuery(c, authorizeSchema);
  await validateAuthorization(input);
  const pending = await createPendingAuthorizationRequest(input);
  const consentUrl = new URL("/connections/authorize", config().frontendUrl);
  consentUrl.searchParams.set("request_id", pending.requestId);
  return c.redirect(consentUrl.toString());
});

mcpOauthRoutes.post("/token", async (c) => {
  await enforceRateLimit(c, "mcp.oauth.token", oauthIpIdentity(c), 300, 60 * 60);
  const input = await parseOAuthBody(c, tokenSchema);
  validateResource(input.resource);
  if (input.grant_type === "authorization_code") {
    const [client] = await getDb().select().from(mcpClients).where(and(eq(mcpClients.clientId, input.client_id), eq(mcpClients.active, true))).limit(1);
    if (!client) return oauthTokenError(c, "invalid_client", "The OAuth client is invalid.", 401);
    const [code] = await getDb().update(mcpAuthorizationCodes).set({ consumedAt: new Date() }).where(and(eq(mcpAuthorizationCodes.codeHash, hashToken(input.code)), eq(mcpAuthorizationCodes.clientId, client.id), eq(mcpAuthorizationCodes.redirectUri, input.redirect_uri), isNull(mcpAuthorizationCodes.consumedAt), gt(mcpAuthorizationCodes.expiresAt, new Date()))).returning();
    if (!code || sha256(input.code_verifier) !== code.codeChallenge) return oauthTokenError(c, "invalid_grant", "The authorization code or PKCE verifier is invalid or expired.");
    const [consent] = await getDb().select({ expiresAt: mcpConsents.expiresAt }).from(mcpConsents).where(and(eq(mcpConsents.clientId, client.id), eq(mcpConsents.userId, code.userId), isNull(mcpConsents.revokedAt), or(isNull(mcpConsents.expiresAt), gt(mcpConsents.expiresAt, new Date())))).limit(1);
    if (!consent) return oauthTokenError(c, "invalid_grant", "The PayMoment connection is expired or revoked. Reconnect to continue.");
    return c.json(await issueTokens(client.id, code.userId, code.scopes, consent.expiresAt));
  }

  const [client] = await getDb().select().from(mcpClients).where(and(eq(mcpClients.clientId, input.client_id), eq(mcpClients.active, true))).limit(1);
  if (!client) return oauthTokenError(c, "invalid_client", "The OAuth client is invalid.", 401);
  const [refresh] = await getDb().select().from(mcpRefreshTokens).where(and(eq(mcpRefreshTokens.tokenHash, hashToken(input.refresh_token)), isNull(mcpRefreshTokens.revokedAt), isNull(mcpRefreshTokens.rotatedAt), or(isNull(mcpRefreshTokens.expiresAt), gt(mcpRefreshTokens.expiresAt, new Date())))).limit(1);
  if (!refresh) return oauthTokenError(c, "invalid_grant", "The refresh token is invalid or expired. Reconnect to continue.");
  const [access] = await getDb().select().from(mcpAccessTokens).where(and(eq(mcpAccessTokens.id, refresh.accessTokenId), eq(mcpAccessTokens.clientId, client.id), isNull(mcpAccessTokens.revokedAt))).limit(1);
  if (!access) return oauthTokenError(c, "invalid_grant", "The refresh token is invalid. Reconnect to continue.");
  const [consent] = await getDb().select({ expiresAt: mcpConsents.expiresAt }).from(mcpConsents).where(and(eq(mcpConsents.clientId, client.id), eq(mcpConsents.userId, access.userId), isNull(mcpConsents.revokedAt), or(isNull(mcpConsents.expiresAt), gt(mcpConsents.expiresAt, new Date())))).limit(1);
  if (!consent) return oauthTokenError(c, "invalid_grant", "The PayMoment connection is expired or revoked. Reconnect to continue.");
  await getDb().update(mcpRefreshTokens).set({ rotatedAt: new Date() }).where(eq(mcpRefreshTokens.id, refresh.id));
  await getDb().update(mcpAccessTokens).set({ revokedAt: new Date() }).where(eq(mcpAccessTokens.id, access.id));
  return c.json(await issueTokens(client.id, access.userId, access.scopes, consent.expiresAt));
});

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

mcpOauthRoutes.get("/.well-known/oauth-authorization-server", (c) => {
  const issuer = `${config().mcpIssuerUrl.replace(/\/$/, "")}/oauth`;
  return c.json({ issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, revocation_endpoint: `${issuer}/revoke`, registration_endpoint: `${issuer}/register`, response_types_supported: ["code"], grant_types_supported: ["authorization_code", "refresh_token"], code_challenge_methods_supported: ["S256"], token_endpoint_auth_methods_supported: ["none"], scopes_supported: scopes, resource_indicators_supported: true });
});
