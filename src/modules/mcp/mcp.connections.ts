import { and, eq, gt, inArray, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { getDb } from "../../db/client";
import { mcpAccessTokens, mcpClients, mcpConsents, mcpRefreshTokens } from "../../db/schema";
import { success } from "../../lib/responses";
import { requireSession } from "../auth/auth.service";

export const mcpConnectionRoutes = new Hono();

mcpConnectionRoutes.get("/connections", async (c) => {
  const session = await requireSession(c);
  const rows = await getDb().select({
    id: mcpClients.id,
    clientId: mcpClients.clientId,
    name: mcpClients.name,
    scopes: mcpConsents.scopes,
    grantedAt: mcpConsents.grantedAt,
    updatedAt: mcpConsents.updatedAt,
    revokedAt: mcpConsents.revokedAt,
  }).from(mcpConsents).innerJoin(mcpClients, eq(mcpClients.id, mcpConsents.clientId)).where(eq(mcpConsents.userId, session.user.id));

  const connections = await Promise.all(rows.map(async (row) => {
    const [token] = await getDb().select({ lastUsedAt: mcpAccessTokens.lastUsedAt, expiresAt: mcpAccessTokens.expiresAt }).from(mcpAccessTokens).where(and(eq(mcpAccessTokens.userId, session.user.id), eq(mcpAccessTokens.clientId, row.id), isNull(mcpAccessTokens.revokedAt), gt(mcpAccessTokens.expiresAt, new Date()))).orderBy(mcpAccessTokens.createdAt).limit(1);
    return { clientId: row.clientId, name: row.name, scopes: row.scopes, grantedAt: row.grantedAt, updatedAt: row.updatedAt, revokedAt: row.revokedAt, status: row.revokedAt ? "revoked" : "active", lastUsedAt: token?.lastUsedAt ?? null, tokenExpiresAt: token?.expiresAt ?? null };
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
