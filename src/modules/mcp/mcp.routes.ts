import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { Hono } from "hono";
import { z } from "zod";
import { requireMcpPrincipal } from "./mcp.auth";
import { createMoment, getLatestFeed } from "../posts/posts.service";
import { getMyProfile } from "../users/users.service";
import { uploadMedia } from "../media/media.service";
import { getDb } from "../../db/client";
import { auditLogs } from "../../db/schema";
import { enforceRateLimit } from "../../lib/rate-limit";
import { config } from "../../config";
import { AppError } from "../../lib/errors";

const base64PayloadSchema = z.string().min(4).max(14 * 1024 * 1024).regex(/^[A-Za-z0-9+/]*={0,2}$/, "Media must be standard base64 without a data URL prefix.");

async function auditMcpAction(userId: string, action: string, entityType: string, entityId?: string, metadata: Record<string, unknown> = {}) {
  await getDb().insert(auditLogs).values({ actorUserId: userId, actorType: "mcp_agent", action, entityType, entityId, metadata });
}

function getServer(userId: string, scopes: string[] = ["paymoment.read", "paymoment.write"]) {
  const server = new McpServer({ name: "paymoment", version: "1.0.0" }, { capabilities: { logging: {} } });
  if (scopes.includes("paymoment.read")) {
    server.registerTool("paymoment_get_profile", { title: "Get PayMoment profile", description: "Read the authenticated PayMoment profile and entitlement.", annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }, inputSchema: {} }, async () => { const profile = await getMyProfile(userId); await auditMcpAction(userId, "mcp.profile.read", "user", userId); return { content: [{ type: "text", text: JSON.stringify(profile) }] }; });
    server.registerTool("paymoment_list_moments", { title: "List PayMoment Moments", description: "Read the authenticated user's visible latest Moments.", annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }, inputSchema: { limit: z.number().int().min(1).max(20).default(10) } }, async ({ limit }) => { const feed = await getLatestFeed(userId, limit); await auditMcpAction(userId, "mcp.moments.list", "feed", undefined, { limit }); return { content: [{ type: "text", text: JSON.stringify(feed) }] }; });
  }
  if (scopes.includes("paymoment.write")) {
    server.registerTool("paymoment_upload_post_media", {
      title: "Upload PayMoment post media",
      description: "Upload one JPEG, PNG, WebP, or GIF image for a later Moment. Pass raw base64 only, without a data URL prefix. Ask for confirmation before uploading.",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
      inputSchema: {
        filename: z.string().trim().min(1).max(120).regex(/^[A-Za-z0-9._-]+$/, "Use a simple filename."),
        mime_type: z.enum(["image/jpeg", "image/png", "image/webp", "image/gif"]),
        data_base64: base64PayloadSchema,
        alt_text: z.string().trim().max(500).optional(),
      },
    }, async ({ filename, mime_type, data_base64, alt_text }) => {
      const file = new File([Buffer.from(data_base64, "base64")], filename, { type: mime_type });
      const media = await uploadMedia(userId, file, "post", alt_text);
      await auditMcpAction(userId, "mcp.media.upload", "media_asset", media.id, { mime_type, byte_size: media.byteSize });
      return { content: [{ type: "text", text: JSON.stringify({ media }) }] };
    });
    server.registerTool("paymoment_create_moment", { title: "Create PayMoment Moment", description: "Publish a public Moment for the authenticated PayMoment user. Ask for confirmation before calling this tool.", annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }, inputSchema: { body: z.string().min(1).max(500), media_asset_ids: z.array(z.uuid()).max(4).default([]) } }, async ({ body, media_asset_ids }) => { const moment = await createMoment(userId, { kind: "moment", body, visibility: "public", media_asset_ids }, "mcp_agent"); const momentId = typeof moment.id === "string" ? moment.id : undefined; await auditMcpAction(userId, "mcp.moment.create", "post", momentId, { media_count: media_asset_ids.length }); return { content: [{ type: "text", text: JSON.stringify(moment) }] }; });
  }
  return server;
}

export const mcpRoutes = new Hono();
mcpRoutes.all("/", async (c) => {
  let session: Awaited<ReturnType<typeof requireMcpPrincipal>>;
  try {
    session = await requireMcpPrincipal(c);
  } catch (error) {
    if (error instanceof AppError && error.status === 401) {
      const issuer = config().mcpIssuerUrl.replace(/\/$/, "");
      c.header("WWW-Authenticate", `Bearer realm="mcp", resource_metadata="${issuer}/.well-known/oauth-protected-resource/mcp", scope="paymoment.read paymoment.write"`);
    }
    throw error;
  }
  await enforceRateLimit(c, "mcp.request", session.user.id, 120, 60);
  const transport = new WebStandardStreamableHTTPServerTransport();
  const server = getServer(session.user.id, session.scopes);
  await server.connect(transport);
  return transport.handleRequest(c.req.raw);
});
