import { and, eq, gt, isNull } from "drizzle-orm";
import type { Context } from "hono";
import { getDb } from "../../db/client";
import { mcpAccessTokens } from "../../db/schema";
import { AppError } from "../../lib/errors";
import { hashToken } from "../auth/session";
import { requireSession } from "../auth/auth.service";

export async function requireMcpPrincipal(c: Context) {
  const authorization = c.req.header("authorization");
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) { const session = await requireSession(c); return { ...session, scopes: ["paymoment.read", "paymoment.write"] }; }
  const [access] = await getDb().select().from(mcpAccessTokens).where(and(eq(mcpAccessTokens.tokenHash, hashToken(token)), isNull(mcpAccessTokens.revokedAt), gt(mcpAccessTokens.expiresAt, new Date()))).limit(1);
  if (!access) throw new AppError(401, "UNAUTHENTICATED", "The MCP access token is invalid or expired.");
  await getDb().update(mcpAccessTokens).set({ lastUsedAt: new Date() }).where(eq(mcpAccessTokens.id, access.id));
  return { sessionId: access.id, user: { id: access.userId }, scopes: access.scopes };
}
