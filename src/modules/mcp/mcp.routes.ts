import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { Hono } from "hono";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { requireMcpPrincipal } from "./mcp.auth";
import { createArticlePost, createMoment, getLatestFeed, getMoment, repostMoment } from "../posts/posts.service";
import { getMyProfile, updateMyProfile } from "../users/users.service";
import { uploadMedia } from "../media/media.service";
import { claimMomentReward, getRewardBalance } from "../rewards/rewards.repository";
import { getDb } from "../../db/client";
import { auditLogs } from "../../db/schema";
import { enforceRateLimit } from "../../lib/rate-limit";
import { config } from "../../config";
import { AppError } from "../../lib/errors";

const base64PayloadSchema = z.string().min(4).max(14 * 1024 * 1024).regex(/^[A-Za-z0-9+/]*={0,2}$/, "Media must be standard base64 without a data URL prefix.");
const postMediaMimeTypes = ["image/jpeg", "image/png", "image/webp", "image/gif", "video/mp4", "video/webm", "video/quicktime"] as const;

async function fetchGeneratedMedia(mediaUrl: string) {
  const url = new URL(mediaUrl);
  if (url.protocol !== "https:" || /^(localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|169\.254\.169\.254|::1)$/i.test(url.hostname) || url.hostname.endsWith(".local")) {
    throw new AppError(422, "VALIDATION_ERROR", "The media URL is not allowed.", { media_url: "Use a public HTTPS media URL." });
  }
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok || !response.url.startsWith("https://")) throw new AppError(422, "VALIDATION_ERROR", "The generated media could not be fetched.", { media_url: "Use an accessible HTTPS media URL." });
  const mimeType = (response.headers.get("content-type") ?? "").split(";", 1)[0].trim().toLowerCase();
  if (!(postMediaMimeTypes as readonly string[]).includes(mimeType)) throw new AppError(422, "VALIDATION_ERROR", "The generated media type is not supported.", { media_url: "Use a JPEG, PNG, WebP, GIF, MP4, WebM, or MOV URL." });
  const contentLength = Number(response.headers.get("content-length") ?? 0);
  if (contentLength > 50 * 1024 * 1024) throw new AppError(422, "VALIDATION_ERROR", "The generated media is too large.", { media_url: "The media must be no larger than 50 MB." });
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > 50 * 1024 * 1024) throw new AppError(422, "VALIDATION_ERROR", "The generated media is too large.", { media_url: "The media must be no larger than 50 MB." });
  const extension = mimeType === "video/quicktime" ? "mov" : mimeType.split("/", 2)[1];
  const filename = `generated-${crypto.randomUUID()}.${extension}`;
  return new File([bytes], filename, { type: mimeType });
}

function brand() {
  return { name: "PayMoment", accent: "violet", website: config().frontendUrl };
}

function proxyMediaUrl(value: unknown) {
  try {
    const url = new URL(String(value ?? ""));
    const publicHost = new URL(config().r2PublicUrl).host;
    return url.protocol === "https:" && url.host === publicHost ? `${config().mcpIssuerUrl.replace(/\/$/, "")}/mcp-media?url=${encodeURIComponent(url.toString())}` : value;
  } catch {
    return value;
  }
}

function decorateProfile(profile: Record<string, any>) {
  return { ...profile, avatar_url: proxyMediaUrl(profile.avatar_url), cover_url: proxyMediaUrl(profile.cover_url) };
}

function decoratePost(post: Record<string, any>) {
  return { ...post, author: post.author ? decorateProfile(post.author) : post.author, media: Array.isArray(post.media) ? post.media.map((item: Record<string, any>) => ({ ...item, url: proxyMediaUrl(item.url) })) : post.media };
}

function socialPostResult(post: Record<string, any>, type = "paymoment.social_post") {
  return { content: [{ type: "text" as const, text: momentCard(post) }], structuredContent: { type, brand: brand(), card: decoratePost(post) } };
}

function rewardResult(data: Record<string, unknown>, title: string) {
  return { content: [{ type: "text" as const, text: `${title}\n\n${JSON.stringify(data)}` }], structuredContent: { type: "paymoment.reward", brand: brand(), reward: { title, ...data } } };
}

function profileText(profile: Record<string, any>) {
  const handle = profile.username ? `@${profile.username}` : "@paymoment.user";
  return [
    `## ${profile.display_name ?? "PayMoment user"} - ${handle}`,
    profile.avatar_url ? `![${profile.display_name ?? "PayMoment avatar"}](${profile.avatar_url})` : "",
    profile.bio ?? "",
    `Followers: ${profile.followers_count ?? 0} - Following: ${profile.following_count ?? 0} - Box: ${profile.entitlement?.points_balance ?? 0}`,
    profile.website_url ? `[Open website](${profile.website_url})` : "",
  ].filter(Boolean).join("\n\n");
}

function markdownText(value: unknown) {
  const markdownCharacters = "\\`*_{}[]()#+-.!|>";
  return [...String(value ?? "")].map((character) => markdownCharacters.includes(character) ? `\\${character}` : character).join("").replace(/\n/g, "  \n");
}

function momentCard(post: Record<string, any>) {
  const author = post.author ?? {};
  const handle = author.username ? `@${author.username}` : "@paymoment.user";
  const media = Array.isArray(post.media) ? post.media.find((item: any) => item?.url)?.url : undefined;
  const link = `${config().frontendUrl.replace(/\/$/, "")}/post/${encodeURIComponent(String(post.id))}`;
  return [
    `### ${markdownText(author.display_name ?? "PayMoment user")} · ${markdownText(handle)}`,
    markdownText(post.body ?? ""),
    media ? `![PayMoment attachment](${media})` : "",
    `[Open on PayMoment](${link})`,
    `♥ ${post.counts?.likes ?? 0}  ·  ↩ ${post.counts?.replies ?? 0}  ·  🔁 ${post.counts?.reposts ?? 0}`,
  ].filter(Boolean).join("\n\n");
}

function socialFeedResult(feed: { data: Array<Record<string, any>>; nextCursor: string | null; hasMore: boolean }) {
  return {
    content: [{ type: "text" as const, text: feed.data.length ? feed.data.map(momentCard).join("\n\n---\n\n") : "No Moments found." }],
    structuredContent: {
      type: "paymoment.social_feed",
      brand: { name: "PayMoment", accent: "violet", website: config().frontendUrl },
      cards: feed.data.map(decoratePost),
      pagination: { next_cursor: feed.nextCursor, has_more: feed.hasMore },
    },
  };
}

async function auditMcpAction(userId: string, action: string, entityType: string, entityId?: string, metadata: Record<string, unknown> = {}) {
  await getDb().insert(auditLogs).values({ actorUserId: userId, actorType: "mcp_agent", action, entityType, entityId, metadata });
}

async function createMomentWithTrace(userId: string, body: string, mediaAssetIds: string[], kind: "moment" | "quote" = "moment", quotedPostId?: string) {
  try {
    return await createMoment(userId, { kind, body, visibility: "public", media_asset_ids: mediaAssetIds, quoted_post_id: quotedPostId }, "mcp_agent");
  } catch (error) {
    console.error(JSON.stringify({ level: "error", message: "MCP create Moment failed", operation: "create_moment", user_id: userId, kind, quoted_post_id: quotedPostId, media_count: mediaAssetIds.length, error: error instanceof Error ? { name: error.name, message: error.message, cause: error.cause } : error }));
    throw error;
  }
}

function getServer(userId: string, scopes: string[] = ["paymoment.read", "paymoment.write"]) {
  const server = new McpServer({ name: "paymoment", version: "1.0.0" }, { capabilities: { logging: {} } });
  const socialResourceUri = "ui://paymoment/social-v3.html";
  const mediaOrigin = new URL(config().mcpIssuerUrl).origin;
  registerAppResource(server, "PayMoment Social UI", socialResourceUri, { mimeType: RESOURCE_MIME_TYPE }, async () => ({ contents: [{ uri: socialResourceUri, mimeType: RESOURCE_MIME_TYPE, text: await readFile(new URL("../../../dist/mcp-app.html", import.meta.url), "utf8"), _meta: { ui: { csp: { resourceDomains: [mediaOrigin] } } } }] }));
  if (scopes.includes("paymoment.read")) {
    registerAppTool(server, "paymoment_get_profile", { title: "Get PayMoment profile", description: "Read the authenticated PayMoment profile and entitlement as a branded interactive card. Include the profile card in the response.", annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }, inputSchema: {}, _meta: { ui: { resourceUri: socialResourceUri } } }, async () => { const profile = await getMyProfile(userId); const cardProfile = decorateProfile(profile as Record<string, any>); await auditMcpAction(userId, "mcp.profile.read", "user", userId); return { content: [{ type: "text", text: profileText(profile as Record<string, any>) }], structuredContent: { type: "paymoment.profile", brand: brand(), profile: cardProfile, card: cardProfile } }; });
    registerAppTool(server, "paymoment_get_box_balance", { title: "Check PayMoment Box balance", description: "Read the authenticated user's current Box balance as a PayMoment card.", annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }, inputSchema: {}, _meta: { ui: { resourceUri: socialResourceUri } } }, async () => { const balance = await getRewardBalance(userId); await auditMcpAction(userId, "mcp.box.balance.read", "reward_balance", userId, { balance }); return rewardResult({ balance, unit: "Box" }, "Your PayMoment Box balance"); });
    registerAppTool(server, "paymoment_list_moments", { title: "List PayMoment Moments", description: "Read the authenticated user's visible latest Moments as interactive PayMoment social cards with author, media, engagement, and links.", annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }, inputSchema: { limit: z.number().int().min(1).max(20).default(10) }, _meta: { ui: { resourceUri: socialResourceUri } } }, async ({ limit }) => { const feed = await getLatestFeed(userId, limit); await auditMcpAction(userId, "mcp.moments.list", "feed", undefined, { limit }); return socialFeedResult(feed); });
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
    server.registerTool("paymoment_upload_profile_media", {
      title: "Upload PayMoment profile media",
      description: "Upload an avatar or profile cover image. Pass raw base64 only, without a data URL prefix. Ask for confirmation before uploading.",
      inputSchema: {
        purpose: z.enum(["avatar", "cover"]),
        filename: z.string().trim().min(1).max(120).regex(/^[A-Za-z0-9._-]+$/),
        mime_type: z.enum(["image/jpeg", "image/png", "image/webp"]),
        data_base64: base64PayloadSchema,
        alt_text: z.string().trim().max(500).optional(),
      },
    }, async ({ purpose, filename, mime_type, data_base64, alt_text }) => {
      const file = new File([Buffer.from(data_base64, "base64")], filename, { type: mime_type });
      const media = await uploadMedia(userId, file, purpose, alt_text);
      await auditMcpAction(userId, "mcp.profile.media.upload", "media_asset", media.id, { purpose, mime_type, byte_size: media.byteSize });
      return { content: [{ type: "text", text: JSON.stringify({ media, next_step: `Call paymoment_update_profile with ${purpose}_url set to media.gatewayUrl.` }) }] };
    });
    server.registerTool("paymoment_update_profile", {
      title: "Update PayMoment profile",
      description: "Update profile details, avatar URL, cover URL, or cover position. Ask for confirmation before changing profile data.",
      inputSchema: {
        display_name: z.string().trim().min(1).max(80).optional(),
        bio: z.string().max(160).optional(),
        location: z.union([z.string().max(120), z.null()]).optional(),
        website_url: z.union([z.url(), z.literal(""), z.null()]).optional(),
        avatar_url: z.union([z.url(), z.literal(""), z.null()]).optional(),
        cover_url: z.union([z.url(), z.literal(""), z.null()]).optional(),
        cover_position: z.enum(["top", "center", "bottom"]).optional(),
      },
    }, async (input) => {
      const profile = await updateMyProfile(userId, input);
      await auditMcpAction(userId, "mcp.profile.update", "user", userId, { fields: Object.keys(input) });
      const cardProfile = decorateProfile(profile as Record<string, any>);
      return { content: [{ type: "text", text: profileText(profile as Record<string, any>) }], structuredContent: { type: "paymoment.profile", brand: brand(), profile: cardProfile, card: cardProfile } };
    });
    registerAppTool(server, "paymoment_create_moment", { title: "Create PayMoment Moment", description: "Publish a public Moment. You may attach previously uploaded media_asset_ids or public HTTPS media_urls, including media generated by ChatGPT or Claude. Ask for confirmation before publishing.", annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }, inputSchema: { body: z.string().min(1).max(500), media_asset_ids: z.array(z.uuid()).max(4).default([]), media_urls: z.array(z.url()).max(4).default([]) }, _meta: { ui: { resourceUri: socialResourceUri } } }, async ({ body, media_asset_ids, media_urls }) => { const imported = await Promise.all(media_urls.map(async (mediaUrl) => uploadMedia(userId, await fetchGeneratedMedia(mediaUrl), "post"))); const allMediaIds = [...media_asset_ids, ...imported.map((media) => media.id)].slice(0, 4); const moment = await createMomentWithTrace(userId, body, allMediaIds); const momentId = typeof moment.id === "string" ? moment.id : undefined; await auditMcpAction(userId, "mcp.moment.create", "post", momentId, { media_count: allMediaIds.length, generated_media_count: media_urls.length }); return { content: [{ type: "text" as const, text: momentCard(moment as Record<string, any>) }], structuredContent: { type: "paymoment.social_post", brand: { name: "PayMoment", accent: "violet", website: config().frontendUrl }, card: decoratePost(moment as Record<string, any>) } }; });
    registerAppTool(server, "paymoment_quote_moment", { title: "Quote a PayMoment Moment", description: "Publish a public quote Moment referencing an existing Moment. Ask for confirmation before calling this tool.", annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }, inputSchema: { quoted_post_id: z.uuid(), body: z.string().min(1).max(500), media_asset_ids: z.array(z.uuid()).max(4).default([]) }, _meta: { ui: { resourceUri: socialResourceUri } } }, async ({ quoted_post_id, body, media_asset_ids }) => { const quote = await createMoment(userId, { kind: "quote", body, visibility: "public", quoted_post_id, media_asset_ids }, "mcp_agent"); const quoteId = typeof quote.id === "string" ? quote.id : undefined; await auditMcpAction(userId, "mcp.moment.quote", "post", quoteId, { quoted_post_id }); return socialPostResult(quote as Record<string, any>, "paymoment.quote"); });
    registerAppTool(server, "paymoment_create_article", { title: "Create a PayMoment article", description: "Create and publish a PayMoment article. The authenticated account must be verified. Ask for confirmation before publishing.", annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }, inputSchema: { title: z.string().min(1).max(120), eyebrow: z.string().max(80).optional(), description: z.string().min(1).max(300), content_html: z.string().min(1).max(200000), banner_media_id: z.uuid().optional(), banner_color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#17181B"), banner_position: z.enum(["left", "center", "right"]).default("center"), visibility: z.enum(["public", "followers", "private"]).default("public") }, _meta: { ui: { resourceUri: socialResourceUri } } }, async (input) => { const article = await createArticlePost(userId, { ...input, publish: true }); const articleId = typeof article.id === "string" ? article.id : undefined; await auditMcpAction(userId, "mcp.article.create", "post", articleId, { published: true }); return socialPostResult(article as Record<string, any>, "paymoment.article"); });
    registerAppTool(server, "paymoment_repost_moment", { title: "Repost or undo a PayMoment Moment", description: "Repost a Moment or remove the authenticated user's repost. Ask for confirmation before changing the repost state.", annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }, inputSchema: { post_id: z.uuid(), repost: z.boolean().default(true) }, _meta: { ui: { resourceUri: socialResourceUri } } }, async ({ post_id, repost }) => { const state = await repostMoment(userId, post_id, repost); const post = await getMoment(userId, post_id); await auditMcpAction(userId, repost ? "mcp.moment.repost" : "mcp.moment.unrepost", "post", post_id, { repost }); return { ...socialPostResult(post as Record<string, any>, "paymoment.repost"), structuredContent: { type: "paymoment.repost", brand: brand(), card: post, reposted: state.reposted, count: state.count } }; });
    registerAppTool(server, "paymoment_claim_moment_box", { title: "Claim Box for a PayMoment Moment", description: "Claim the Box reward for the authenticated user's published Moment. Ask for confirmation before claiming.", annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }, inputSchema: { post_id: z.uuid() }, _meta: { ui: { resourceUri: socialResourceUri } } }, async ({ post_id }) => { const result = await claimMomentReward(userId, post_id); await auditMcpAction(userId, "mcp.box.claim_moment", "reward", post_id, result); return rewardResult({ ...result, unit: "Box", post_id }, result.claimed ? "Box claimed for your Moment" : "Box already claimed for this Moment"); });
  }
  return server;
}

export const mcpRoutes = new Hono();
export const mcpMediaRoutes = new Hono();
mcpMediaRoutes.get("/", async (c) => {
  const raw = c.req.query("url");
  if (!raw) return c.text("Missing media URL.", 400);
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.host !== new URL(config().r2PublicUrl).host) return c.text("Media URL is not allowed.", 403);
    const upstream = await fetch(url);
    if (!upstream.ok || !upstream.body) return c.text("Media is unavailable.", 404);
    return new Response(upstream.body, { status: 200, headers: { "Content-Type": upstream.headers.get("content-type") ?? "application/octet-stream", "Cache-Control": "public, max-age=3600", "Access-Control-Allow-Origin": "*" } });
  } catch {
    return c.text("Media URL is invalid.", 400);
  }
});
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
