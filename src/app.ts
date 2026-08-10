import { cors } from "hono/cors";
import { Hono } from "hono";
import { config } from "./config";
import { checkReadiness, type ReadinessResult } from "./health";
import { AppError, errorPayload, handleError } from "./lib/errors";
import { requestIdMiddleware } from "./lib/request-id";
import { success } from "./lib/responses";
import { auth } from "./modules/auth/auth.routes";
import { mediaRoutes } from "./modules/media/media.routes";
import { articlesRoutes, bookmarksRoutes, feedRoutes, likesRoutes, pollsRoutes, postsRoutes, repliesRoutes } from "./modules/posts/posts.routes";
import { usersRoutes } from "./modules/users/users.routes";
import { discoverRoutes } from "./modules/discover/discover.routes";
import { notificationsRoutes } from "./modules/notifications/notifications.routes";
import { rewardsRoutes } from "./modules/rewards/rewards.routes";
import { messagesRoutes } from "./modules/messages/messages.routes";
import { mcpRoutes } from "./modules/mcp/mcp.routes";
import { reportsRoutes } from "./modules/reports/reports.routes";
import { mcpOauthRoutes } from "./modules/mcp/mcp.oauth";
import { mcpConnectionRoutes } from "./modules/mcp/mcp.connections";

type AppDependencies = {
  readiness?: () => Promise<ReadinessResult>;
};

export function createApp(dependencies: AppDependencies = {}) {
  const app = new Hono();
  const readiness = dependencies.readiness ?? checkReadiness;
  app.use("*", requestIdMiddleware);
  app.use("/api/*", cors({
    origin: config().frontendUrl,
    credentials: true,
    allowHeaders: ["Content-Type", "Idempotency-Key", "If-Match", "X-Request-Id"],
    exposeHeaders: ["X-Request-Id", "Retry-After"],
  }));
  const mcpCors = cors({
    origin: "*",
    credentials: false,
    allowHeaders: ["Authorization", "Content-Type", "MCP-Protocol-Version", "Mcp-Session-Id", "Last-Event-ID"],
    exposeHeaders: ["MCP-Protocol-Version", "Mcp-Session-Id"],
  });
  app.use("/mcp", mcpCors);
  app.use("/mcp/*", mcpCors);
  app.get("/health", (c) => success(c, { ok: true, service: "paymoment-api", runtime: "bun" }));
  app.get("/.well-known/oauth-protected-resource/mcp", (c) => c.json({ resource: `${config().mcpIssuerUrl.replace(/\/$/, "")}/mcp`, authorization_servers: [`${config().mcpIssuerUrl.replace(/\/$/, "")}/oauth`] }));
  app.get("/.well-known/oauth-authorization-server", (c) => { const issuer = `${config().mcpIssuerUrl.replace(/\/$/, "")}/oauth`; return c.json({ issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, revocation_endpoint: `${issuer}/revoke`, registration_endpoint: `${issuer}/register`, response_types_supported: ["code"], grant_types_supported: ["authorization_code", "refresh_token"], code_challenge_methods_supported: ["S256"], token_endpoint_auth_methods_supported: ["none"], scopes_supported: ["paymoment.read", "paymoment.write"] }); });
  app.get("/ready", async (c) => {
    const result = await readiness();
    if (!result.ok) {
      const error = new AppError(503, "SERVICE_UNAVAILABLE", "One or more required services are unavailable.");
      return c.json({ ...errorPayload(c, error), checks: result.checks }, 503);
    }
    return success(c, result);
  });
  app.route("/api/v1/auth", auth);
  app.route("/api/v1/media", mediaRoutes);
  app.route("/api/v1/posts", postsRoutes);
  app.route("/api/v1/feed", feedRoutes);
  app.route("/api/v1/bookmarks", bookmarksRoutes);
  app.route("/api/v1/likes", likesRoutes);
  app.route("/api/v1/articles", articlesRoutes);
  app.route("/api/v1/replies", repliesRoutes);
  app.route("/api/v1/polls", pollsRoutes);
  app.route("/api/v1/users", usersRoutes);
  app.route("/api/v1/discover", discoverRoutes);
  app.route("/api/v1/notifications", notificationsRoutes);
  app.route("/api/v1/rewards", rewardsRoutes);
  app.route("/api/v1", messagesRoutes);
  app.route("/api/v1/reports", reportsRoutes);
  app.route("/oauth", mcpOauthRoutes);
  app.route("/api/v1/mcp", mcpConnectionRoutes);
  app.route("/mcp", mcpRoutes);
  app.notFound((c) => {
    const error = new AppError(404, "NOT_FOUND", "The requested resource was not found.");
    return c.json(errorPayload(c, error), 404);
  });
  app.onError(handleError);
  return app;
}
