import { and, eq, gt, inArray, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { getDb } from "../../db/client";
import { mcpAccessTokens, mcpClients, mcpConsents, mcpRefreshTokens } from "../../db/schema";
import { AppError } from "../../lib/errors";
import { success } from "../../lib/responses";
import { parseJson } from "../../lib/validation";
import { requireSession } from "../auth/auth.service";
import { CONNECTION_DURATIONS, connectionDurationSchema, grantAuthorization, oauthPermissionLabels, oauthRedirect, validateAuthorization } from "./mcp.oauth";
import { consumePendingAuthorizationRequest, getPendingAuthorizationRequest } from "./mcp.oauth-request";

export const mcpConnectionRoutes = new Hono();
const oauthRequestIdSchema = z.string().regex(/^[A-Za-z0-9_-]{20,128}$/);
const oauthDecisionSchema = z.discriminatedUnion("decision", [
  z.object({ decision: z.literal("approve"), expires_in_days: connectionDurationSchema.default("never") }),
  z.object({ decision: z.literal("deny"), expires_in_days: connectionDurationSchema.optional() }),
]);

function missingOAuthRequest() {
  return new AppError(404, "NOT_FOUND", "This connection request has expired or was already used.");
}

function oauthRequestId(value: string) {
  const parsed = oauthRequestIdSchema.safeParse(value);
  if (!parsed.success) throw new AppError(422, "VALIDATION_ERROR", "The connection request ID is invalid.");
  return parsed.data;
}

mcpConnectionRoutes.get("/oauth-requests/:requestId", async (c) => {
  await requireSession(c);
  const requestId = oauthRequestId(c.req.param("requestId"));
  const request = await getPendingAuthorizationRequest(requestId);
  if (!request) throw missingOAuthRequest();
  const { client, requestedScopes } = await validateAuthorization(request);
  return success(c, {
    request_id: requestId,
    client: { name: client.name },
    permissions: requestedScopes.map((scope) => ({
      scope,
      ...(oauthPermissionLabels[scope] ?? { title: scope, description: "Access requested by this connector." }),
    })),
    expiration: { options: CONNECTION_DURATIONS, default: "never" },
  });
});

mcpConnectionRoutes.post("/oauth-requests/:requestId", async (c) => {
  const session = await requireSession(c);
  const requestId = oauthRequestId(c.req.param("requestId"));
  const input = await parseJson(c, oauthDecisionSchema);
  const request = await consumePendingAuthorizationRequest(requestId);
  if (!request) throw missingOAuthRequest();
  await validateAuthorization(request);
  const redirectUrl = input.decision === "deny"
    ? oauthRedirect(request, { error: "access_denied", error_description: "The user denied authorization." })
    : await grantAuthorization(session.user.id, request, input.expires_in_days);
  return success(c, { redirect_url: redirectUrl });
});

mcpConnectionRoutes.get("/connections", async (c) => {
  const session = await requireSession(c);
  const rows = await getDb().select({
    id: mcpClients.id,
    clientId: mcpClients.clientId,
    name: mcpClients.name,
    scopes: mcpConsents.scopes,
    grantedAt: mcpConsents.grantedAt,
    expiresAt: mcpConsents.expiresAt,
    updatedAt: mcpConsents.updatedAt,
    revokedAt: mcpConsents.revokedAt,
  }).from(mcpConsents).innerJoin(mcpClients, eq(mcpClients.id, mcpConsents.clientId)).where(and(eq(mcpConsents.userId, session.user.id), isNull(mcpConsents.revokedAt)));

  const now = new Date();
  const connections = await Promise.all(rows.map(async (row) => {
    const expired = row.expiresAt ? row.expiresAt <= now : false;
    const [token] = await getDb().select({ lastUsedAt: mcpAccessTokens.lastUsedAt, expiresAt: mcpAccessTokens.expiresAt }).from(mcpAccessTokens).where(and(eq(mcpAccessTokens.userId, session.user.id), eq(mcpAccessTokens.clientId, row.id), isNull(mcpAccessTokens.revokedAt), gt(mcpAccessTokens.expiresAt, new Date()))).orderBy(mcpAccessTokens.createdAt).limit(1);
    return { clientId: row.clientId, name: row.name, scopes: row.scopes, grantedAt: row.grantedAt, expiresAt: row.expiresAt, updatedAt: row.updatedAt, revokedAt: row.revokedAt, status: expired ? "expired" : "active", lastUsedAt: token?.lastUsedAt ?? null, tokenExpiresAt: token?.expiresAt ?? null };
  }));
  return success(c, { connections });
});

mcpConnectionRoutes.delete("/connections/:clientId", async (c) => {
  const session = await requireSession(c);
  const [client] = await getDb().select({ id: mcpClients.id }).from(mcpClients).where(eq(mcpClients.clientId, c.req.param("clientId"))).limit(1);
  if (!client) return success(c, { revoked: true });

  await getDb().transaction(async (tx) => {
    const accessTokens = await tx.select({ id: mcpAccessTokens.id }).from(mcpAccessTokens).where(and(eq(mcpAccessTokens.userId, session.user.id), eq(mcpAccessTokens.clientId, client.id), isNull(mcpAccessTokens.revokedAt)));
    await tx.update(mcpConsents).set({ revokedAt: new Date(), updatedAt: new Date() }).where(and(eq(mcpConsents.userId, session.user.id), eq(mcpConsents.clientId, client.id)));
    if (accessTokens.length) {
      const accessTokenIds = accessTokens.map((token) => token.id);
      await tx.update(mcpAccessTokens).set({ revokedAt: new Date() }).where(inArray(mcpAccessTokens.id, accessTokenIds));
      await tx.update(mcpRefreshTokens).set({ revokedAt: new Date() }).where(inArray(mcpRefreshTokens.accessTokenId, accessTokenIds));
    }
  });
  return success(c, { revoked: true });
});
