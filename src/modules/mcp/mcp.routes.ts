import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { Hono } from "hono";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { requireMcpPrincipal } from "./mcp.auth";
import { castPollVote, createArticlePost, createMoment, createPostReply, deleteArticlePost, deleteMoment, editArticlePost, editMoment, getArticleDrafts, getLatestFeed, getMoment, likeMoment, pinMoment, publishArticlePost, repostMoment, scheduleArticlePost, unvotePoll } from "../posts/posts.service";
import { follow, getMyProfile, setBlocked, setMuted, unfollow, updateMyProfile } from "../users/users.service";
import { deleteMedia, getMedia, uploadMedia } from "../media/media.service";
import { claimMomentReward, getRewardBalance, listRewardLedger } from "../rewards/rewards.repository";
import { searchDiscover } from "../discover/discover.repository";
import { listNotifications } from "../notifications/notifications.repository";
import { createDirectConversation, listConversations, listMessages, sendMessage } from "../messages/messages.repository";
import { createReport } from "../reports/reports.repository";
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

function actionResult(title: string, data: unknown, cards: Array<Record<string, any>> = []) {
  return { content: [{ type: "text" as const, text: `${title}\n\n${JSON.stringify(data)}` }], structuredContent: { type: "paymoment.action", brand: brand(), action: { title, data }, cards: cards.map(decoratePost) } };
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
    registerAppTool(server, "paymoment_get_post", { title: "Open a PayMoment post", description: "Read one Moment or article by ID as a branded card.", inputSchema: { post_id: z.uuid() }, _meta: { ui: { resourceUri: socialResourceUri } } }, async ({ post_id }) => { const post = await getMoment(userId, post_id); await auditMcpAction(userId, "mcp.post.read", "post", post_id); return socialPostResult(post as Record<string, any>); });
    registerAppTool(server, "paymoment_search", { title: "Search PayMoment", description: "Search users, Moments, articles, or hashtags.", inputSchema: { query: z.string().trim().min(1).max(120), type: z.enum(["all", "people", "moments", "articles", "topics"]).default("all"), limit: z.number().int().min(1).max(20).default(10) }, _meta: { ui: { resourceUri: socialResourceUri } } }, async ({ query, type, limit }) => { const result = await searchDiscover(userId, query, type, limit); await auditMcpAction(userId, "mcp.search", "search", undefined, { query, type, limit }); return { content: [{ type: "text" as const, text: JSON.stringify(result) }], structuredContent: { type: "paymoment.search", brand: brand(), results: { ...result, moments: result.moments.filter(Boolean).map((post) => decoratePost(post as Record<string, any>)), articles: result.articles.filter(Boolean).map((post) => decoratePost(post as Record<string, any>)) } } }; });
    registerAppTool(server, "paymoment_list_notifications", { title: "View PayMoment notifications", description: "Read the authenticated user's activity notifications with cursor pagination.", inputSchema: { filter: z.enum(["all", "unread", "likes", "replies", "mentions", "follows", "rewards", "reposts"]).default("all"), limit: z.number().int().min(1).max(50).default(30), cursor: z.string().max(2048).optional() }, _meta: { ui: { resourceUri: socialResourceUri } } }, async ({ filter, limit, cursor }) => { const result = await listNotifications(userId, filter, limit, cursor); await auditMcpAction(userId, "mcp.notifications.list", "notification", undefined, { filter, limit }); return actionResult("PayMoment notifications", result); });
    registerAppTool(server, "paymoment_get_analytics", { title: "View PayMoment analytics", description: "Read account or post engagement metrics available to the authenticated account.", inputSchema: { post_id: z.uuid().optional() }, _meta: { ui: { resourceUri: socialResourceUri } } }, async ({ post_id }) => { const data = post_id ? await getMoment(userId, post_id) : await getLatestFeed(userId, 20); await auditMcpAction(userId, "mcp.analytics.read", post_id ? "post" : "user", post_id, { scope: post_id ? "post" : "account" }); return actionResult(post_id ? "Post analytics" : "Account analytics", post_id ? { post_id, counts: (data as any).counts, published_at: (data as any).published_at } : { recent_posts: (data as any).data?.map((post: any) => ({ id: post.id, counts: post.counts })) ?? [], pagination: data }); });
    registerAppTool(server, "paymoment_list_rewards", { title: "View Box reward history", description: "Read the authenticated user's Box reward ledger.", inputSchema: {}, _meta: { ui: { resourceUri: socialResourceUri } } }, async () => { const ledger = await listRewardLedger(userId); await auditMcpAction(userId, "mcp.rewards.list", "reward_ledger", userId); return actionResult("Box reward history", ledger); });
    registerAppTool(server, "paymoment_list_conversations", { title: "Read PayMoment conversations", description: "List direct message conversations and unread state.", inputSchema: {}, _meta: { ui: { resourceUri: socialResourceUri } } }, async () => { const conversations = await listConversations(userId); await auditMcpAction(userId, "mcp.messages.conversations", "conversation", userId); return actionResult("PayMoment conversations", conversations); });
    registerAppTool(server, "paymoment_read_messages", { title: "Read PayMoment DM", description: "Read messages from a conversation with cursor pagination.", inputSchema: { conversation_id: z.uuid(), limit: z.number().int().min(1).max(50).default(30), cursor: z.string().max(2048).optional() }, _meta: { ui: { resourceUri: socialResourceUri } } }, async ({ conversation_id, limit, cursor }) => { const messages = await listMessages(userId, conversation_id, limit, cursor); await auditMcpAction(userId, "mcp.messages.read", "conversation", conversation_id, { limit }); return actionResult("Direct messages", messages); });
    registerAppTool(server, "paymoment_get_media", { title: "View uploaded media", description: "Read metadata for one media asset owned by the authenticated account.", inputSchema: { media_id: z.uuid() }, _meta: { ui: { resourceUri: socialResourceUri } } }, async ({ media_id }) => { const media = await getMedia(userId, media_id); await auditMcpAction(userId, "mcp.media.read", "media_asset", media_id); return actionResult("Uploaded media", media); });
    registerAppTool(server, "paymoment_list_article_drafts", { title: "List PayMoment article drafts", description: "Read the authenticated user's article drafts so they can be edited or published.", inputSchema: { limit: z.number().int().min(1).max(50).default(20) }, _meta: { ui: { resourceUri: socialResourceUri } } }, async ({ limit }) => { const drafts = await getArticleDrafts(userId, limit); await auditMcpAction(userId, "mcp.article.drafts.list", "user", userId, { limit }); return { content: [{ type: "text" as const, text: drafts.map((post) => momentCard(post as Record<string, any>)).join("\n\n---\n\n") || "No article drafts found." }], structuredContent: { type: "paymoment.social_feed", brand: brand(), cards: drafts.filter(Boolean).map((post) => decoratePost(post as Record<string, any>)) } }; });
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
    server.registerTool("paymoment_upload_media_batch", {
      title: "Upload multiple PayMoment media files",
      description: "Upload up to four images or videos for a Moment. Pass raw base64 without data URL prefixes. Ask for confirmation before uploading.",
      inputSchema: { files: z.array(z.object({ filename: z.string().trim().min(1).max(120).regex(/^[A-Za-z0-9._-]+$/), mime_type: z.enum(postMediaMimeTypes), data_base64: base64PayloadSchema, alt_text: z.string().trim().max(500).optional() })).min(1).max(4) },
    }, async ({ files }) => {
      const media = await Promise.all(files.map(({ filename, mime_type, data_base64, alt_text }) => uploadMedia(userId, new File([Buffer.from(data_base64, "base64")], filename, { type: mime_type }), "post", alt_text)));
      await auditMcpAction(userId, "mcp.media.batch_upload", "media_asset", undefined, { count: media.length });
      return actionResult("Uploaded Moment media", media);
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
    registerAppTool(server, "paymoment_edit_moment", { title: "Edit a PayMoment Moment", description: "Edit an owned Moment. Include the current version from the post card and ask for confirmation.", annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }, inputSchema: { post_id: z.uuid(), version: z.number().int().positive(), body: z.string().trim().max(500).optional(), visibility: z.enum(["public", "followers", "private"]).optional() }, _meta: { ui: { resourceUri: socialResourceUri } } }, async ({ post_id, version, body, visibility }) => { const post = await editMoment(userId, post_id, version, { ...(body !== undefined ? { body } : {}), ...(visibility !== undefined ? { visibility } : {}) }); await auditMcpAction(userId, "mcp.moment.edit", "post", post_id); return socialPostResult(post as Record<string, any>); });
    registerAppTool(server, "paymoment_delete_moment", { title: "Delete a PayMoment Moment", description: "Delete an owned Moment after confirmation.", annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false }, inputSchema: { post_id: z.uuid() }, _meta: { ui: { resourceUri: socialResourceUri } } }, async ({ post_id }) => { const result = await deleteMoment(userId, post_id); await auditMcpAction(userId, "mcp.moment.delete", "post", post_id); return actionResult("Moment deleted", result); });
    registerAppTool(server, "paymoment_edit_article", { title: "Edit a PayMoment article", description: "Edit an owned article draft or published article using its current draft version.", annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }, inputSchema: { post_id: z.uuid(), draft_version: z.number().int().positive(), title: z.string().trim().max(120).optional(), eyebrow: z.string().trim().max(80).optional(), description: z.string().trim().max(300).optional(), content_html: z.string().max(200000).optional(), banner_media_id: z.uuid().optional(), banner_color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(), banner_position: z.enum(["left", "center", "right"]).optional(), visibility: z.enum(["public", "followers", "private"]).optional() }, _meta: { ui: { resourceUri: socialResourceUri } } }, async (input) => { const { post_id, ...articleInput } = input; const post = await editArticlePost(userId, post_id, { ...articleInput, draft_version: input.draft_version }); await auditMcpAction(userId, "mcp.article.edit", "post", input.post_id); return socialPostResult(post as Record<string, any>, "paymoment.article"); });
    registerAppTool(server, "paymoment_delete_article", { title: "Delete a PayMoment article", description: "Delete an owned article after confirmation.", annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false }, inputSchema: { post_id: z.uuid() }, _meta: { ui: { resourceUri: socialResourceUri } } }, async ({ post_id }) => { const result = await deleteArticlePost(userId, post_id); await auditMcpAction(userId, "mcp.article.delete", "post", post_id); return actionResult("Article deleted", result); });
    registerAppTool(server, "paymoment_publish_article", { title: "Publish a PayMoment article", description: "Publish an owned article draft after confirmation.", annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }, inputSchema: { post_id: z.uuid() }, _meta: { ui: { resourceUri: socialResourceUri } } }, async ({ post_id }) => { const post = await publishArticlePost(userId, post_id); await auditMcpAction(userId, "mcp.article.publish", "post", post_id); return socialPostResult(post as Record<string, any>, "paymoment.article"); });
    registerAppTool(server, "paymoment_schedule_article", { title: "Schedule a PayMoment article", description: "Schedule an owned article draft for future publication, or pass null to cancel its schedule.", annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }, inputSchema: { post_id: z.uuid(), scheduled_at: z.iso.datetime().nullable() }, _meta: { ui: { resourceUri: socialResourceUri } } }, async ({ post_id, scheduled_at }) => { const schedule = typeof scheduled_at === "string" ? scheduled_at : null; const post = await scheduleArticlePost(userId, post_id, schedule); await auditMcpAction(userId, schedule ? "mcp.article.schedule" : "mcp.article.unschedule", "post", post_id, { scheduled_at: schedule }); return socialPostResult(post as Record<string, any>, "paymoment.article"); });
    registerAppTool(server, "paymoment_set_reaction", { title: "Like or bookmark a PayMoment post", description: "Like/unlike or bookmark/unbookmark a Moment or article.", annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }, inputSchema: { post_id: z.uuid(), reaction: z.enum(["like", "bookmark"]), enabled: z.boolean() }, _meta: { ui: { resourceUri: socialResourceUri } } }, async ({ post_id, reaction, enabled }) => { const result = reaction === "like" ? await likeMoment(userId, post_id, enabled) : await import("../posts/posts.service").then(({ bookmarkMoment }) => bookmarkMoment(userId, post_id, enabled)); await auditMcpAction(userId, `mcp.${reaction}.${enabled ? "enable" : "disable"}`, "post", post_id); return actionResult(`${reaction === "like" ? "Like" : "Bookmark"} updated`, result, [await getMoment(userId, post_id) as Record<string, any>]); });
    registerAppTool(server, "paymoment_reply", { title: "Reply to a PayMoment post", description: "Create a reply/comment on a visible Moment or article.", annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }, inputSchema: { post_id: z.uuid(), body: z.string().trim().min(1).max(500), parent_id: z.uuid().optional(), media_asset_ids: z.array(z.uuid()).max(1).default([]) }, _meta: { ui: { resourceUri: socialResourceUri } } }, async ({ post_id, body, parent_id, media_asset_ids }) => { const reply = await createPostReply(userId, post_id, { body, parent_id, media_asset_ids }, "mcp_agent"); await auditMcpAction(userId, "mcp.reply.create", "reply", reply.id); return actionResult("Reply created", reply); });
    registerAppTool(server, "paymoment_follow", { title: "Follow or unfollow a PayMoment user", description: "Follow or unfollow a user. Private-account requests are handled by the account policy.", annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }, inputSchema: { user_id: z.uuid(), following: z.boolean() }, _meta: { ui: { resourceUri: socialResourceUri } } }, async ({ user_id, following }) => { const result = following ? await follow(userId, user_id) : await unfollow(userId, user_id); await auditMcpAction(userId, `mcp.follow.${following ? "create" : "remove"}`, "user", user_id); return actionResult(following ? "Following updated" : "Unfollowed", result); });
    registerAppTool(server, "paymoment_pin", { title: "Pin or unpin a PayMoment post", description: "Pin or unpin one of your Moments or articles on your profile.", annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }, inputSchema: { post_id: z.uuid(), pinned: z.boolean() }, _meta: { ui: { resourceUri: socialResourceUri } } }, async ({ post_id, pinned }) => { const result = await pinMoment(userId, post_id, pinned); await auditMcpAction(userId, `mcp.post.${pinned ? "pin" : "unpin"}`, "post", post_id); return actionResult(pinned ? "Post pinned" : "Post unpinned", result); });
    registerAppTool(server, "paymoment_create_poll", { title: "Create a PayMoment poll", description: "Publish a poll Moment with two to four options.", annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }, inputSchema: { body: z.string().max(500).default(""), question: z.string().trim().min(1).max(160), options: z.array(z.string().trim().min(1).max(80)).min(2).max(4), voter_visibility: z.enum(["public", "anonymous"]).default("public"), allow_vote_change: z.boolean().default(true), ends_at: z.iso.datetime().optional() }, _meta: { ui: { resourceUri: socialResourceUri } } }, async ({ body, question, options, voter_visibility, allow_vote_change, ends_at }) => { const pollEndsAt = typeof ends_at === "string" ? ends_at : undefined; const post = await createMoment(userId, { kind: "poll", body: String(body ?? ""), visibility: "public", media_asset_ids: [], poll: { question: String(question), options: Array.isArray(options) ? options.map(String) : [], voter_visibility: voter_visibility === "anonymous" ? "anonymous" : "public", allow_vote_change: Boolean(allow_vote_change), ...(pollEndsAt ? { ends_at: pollEndsAt } : {}) } }, "mcp_agent"); const postId = typeof post.id === "string" ? post.id : undefined; await auditMcpAction(userId, "mcp.poll.create", "post", postId); return socialPostResult(post as Record<string, any>); });
    registerAppTool(server, "paymoment_vote_poll", { title: "Vote in a PayMoment poll", description: "Cast or remove a vote in a visible poll.", inputSchema: { post_id: z.uuid(), option_id: z.uuid(), remove: z.boolean().default(false) }, _meta: { ui: { resourceUri: socialResourceUri } } }, async ({ post_id, option_id, remove }) => { const result = remove ? await unvotePoll(userId, post_id) : await castPollVote(userId, post_id, option_id); await auditMcpAction(userId, "mcp.poll.vote", "post", post_id, { remove }); return actionResult("Poll vote updated", result); });
    registerAppTool(server, "paymoment_create_moment", { title: "Create PayMoment Moment", description: "Publish a public Moment. You may attach previously uploaded media_asset_ids or public HTTPS media_urls, including media generated by ChatGPT or Claude. Ask for confirmation before publishing.", annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }, inputSchema: { body: z.string().min(1).max(500), media_asset_ids: z.array(z.uuid()).max(4).default([]), media_urls: z.array(z.url()).max(4).default([]) }, _meta: { ui: { resourceUri: socialResourceUri } } }, async ({ body, media_asset_ids, media_urls }) => { const imported = await Promise.all(media_urls.map(async (mediaUrl) => uploadMedia(userId, await fetchGeneratedMedia(mediaUrl), "post"))); const allMediaIds = [...media_asset_ids, ...imported.map((media) => media.id)].slice(0, 4); const moment = await createMomentWithTrace(userId, body, allMediaIds); const momentId = typeof moment.id === "string" ? moment.id : undefined; await auditMcpAction(userId, "mcp.moment.create", "post", momentId, { media_count: allMediaIds.length, generated_media_count: media_urls.length }); return { content: [{ type: "text" as const, text: momentCard(moment as Record<string, any>) }], structuredContent: { type: "paymoment.social_post", brand: { name: "PayMoment", accent: "violet", website: config().frontendUrl }, card: decoratePost(moment as Record<string, any>) } }; });
    registerAppTool(server, "paymoment_quote_moment", { title: "Quote a PayMoment Moment", description: "Publish a public quote Moment referencing an existing Moment. Ask for confirmation before calling this tool.", annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }, inputSchema: { quoted_post_id: z.uuid(), body: z.string().min(1).max(500), media_asset_ids: z.array(z.uuid()).max(4).default([]) }, _meta: { ui: { resourceUri: socialResourceUri } } }, async ({ quoted_post_id, body, media_asset_ids }) => { const quote = await createMoment(userId, { kind: "quote", body, visibility: "public", quoted_post_id, media_asset_ids }, "mcp_agent"); const quoteId = typeof quote.id === "string" ? quote.id : undefined; await auditMcpAction(userId, "mcp.moment.quote", "post", quoteId, { quoted_post_id }); return socialPostResult(quote as Record<string, any>, "paymoment.quote"); });
    registerAppTool(server, "paymoment_create_article", { title: "Create a PayMoment article", description: "Create and publish a PayMoment article. The authenticated account must be verified. Ask for confirmation before publishing.", annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }, inputSchema: { title: z.string().min(1).max(120), eyebrow: z.string().max(80).optional(), description: z.string().min(1).max(300), content_html: z.string().min(1).max(200000), banner_media_id: z.uuid().optional(), banner_color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#17181B"), banner_position: z.enum(["left", "center", "right"]).default("center"), visibility: z.enum(["public", "followers", "private"]).default("public") }, _meta: { ui: { resourceUri: socialResourceUri } } }, async (input) => { const article = await createArticlePost(userId, { ...input, publish: true }); const articleId = typeof article.id === "string" ? article.id : undefined; await auditMcpAction(userId, "mcp.article.create", "post", articleId, { published: true }); return socialPostResult(article as Record<string, any>, "paymoment.article"); });
    registerAppTool(server, "paymoment_create_article_draft", { title: "Save a PayMoment article draft", description: "Create an unpublished article draft for later editing or publishing.", annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }, inputSchema: { title: z.string().min(1).max(120), eyebrow: z.string().max(80).optional(), description: z.string().min(1).max(300), content_html: z.string().min(1).max(200000), banner_media_id: z.uuid().optional(), banner_color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#17181B"), banner_position: z.enum(["left", "center", "right"]).default("center"), visibility: z.enum(["public", "followers", "private"]).default("public") }, _meta: { ui: { resourceUri: socialResourceUri } } }, async (input) => { const article = await createArticlePost(userId, { ...input, publish: false }); const articleId = typeof article.id === "string" ? article.id : undefined; await auditMcpAction(userId, "mcp.article.create_draft", "post", articleId); return socialPostResult(article as Record<string, any>, "paymoment.article.draft"); });
    registerAppTool(server, "paymoment_repost_moment", { title: "Repost or undo a PayMoment Moment", description: "Repost a Moment or remove the authenticated user's repost. Ask for confirmation before changing the repost state.", annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }, inputSchema: { post_id: z.uuid(), repost: z.boolean().default(true) }, _meta: { ui: { resourceUri: socialResourceUri } } }, async ({ post_id, repost }) => { const state = await repostMoment(userId, post_id, repost); const post = await getMoment(userId, post_id); await auditMcpAction(userId, repost ? "mcp.moment.repost" : "mcp.moment.unrepost", "post", post_id, { repost }); return { ...socialPostResult(post as Record<string, any>, "paymoment.repost"), structuredContent: { type: "paymoment.repost", brand: brand(), card: post, reposted: state.reposted, count: state.count } }; });
    registerAppTool(server, "paymoment_claim_moment_box", { title: "Claim Box for a PayMoment Moment", description: "Claim the Box reward for the authenticated user's published Moment. Ask for confirmation before claiming.", annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }, inputSchema: { post_id: z.uuid() }, _meta: { ui: { resourceUri: socialResourceUri } } }, async ({ post_id }) => { const result = await claimMomentReward(userId, post_id); await auditMcpAction(userId, "mcp.box.claim_moment", "reward", post_id, result); return rewardResult({ ...result, unit: "Box", post_id }, result.claimed ? "Box claimed for your Moment" : "Box already claimed for this Moment"); });
  }
    server.registerTool("paymoment_delete_media", { title: "Delete uploaded PayMoment media", description: "Delete an unattached media asset owned by the authenticated account after confirmation.", annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false }, inputSchema: { media_id: z.uuid() } }, async ({ media_id }) => { const result = await deleteMedia(userId, media_id); await auditMcpAction(userId, "mcp.media.delete", "media_asset", media_id); return actionResult("Media deleted", result); });
    registerAppTool(server, "paymoment_block_user", { title: "Block or unblock a PayMoment user", description: "Block or unblock a user after confirmation.", annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false }, inputSchema: { user_id: z.uuid(), blocked: z.boolean() }, _meta: { ui: { resourceUri: socialResourceUri } } }, async ({ user_id, blocked }) => { const result = await setBlocked(userId, user_id, blocked); await auditMcpAction(userId, `mcp.user.${blocked ? "block" : "unblock"}`, "user", user_id); return actionResult(blocked ? "User blocked" : "User unblocked", result); });
    registerAppTool(server, "paymoment_mute_user", { title: "Mute or unmute a PayMoment user", description: "Mute or unmute a user, optionally with an expiration timestamp.", annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }, inputSchema: { user_id: z.uuid(), muted: z.boolean(), expires_at: z.iso.datetime().nullable().optional() }, _meta: { ui: { resourceUri: socialResourceUri } } }, async ({ user_id, muted, expires_at }) => { const expires = typeof expires_at === "string" ? expires_at : null; const result = await setMuted(userId, user_id, muted, expires); await auditMcpAction(userId, `mcp.user.${muted ? "mute" : "unmute"}`, "user", user_id); return actionResult(muted ? "User muted" : "User unmuted", result); });
    registerAppTool(server, "paymoment_report", { title: "Report a PayMoment account or post", description: "Submit a moderation report for a user, post, reply, or message.", annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false }, inputSchema: { target_type: z.enum(["user", "post", "reply", "message"]), target_id: z.uuid(), reason: z.enum(["spam", "harassment", "hate", "violence", "sexual_content", "impersonation", "self_harm", "other"]), details: z.string().trim().max(2000).optional() }, _meta: { ui: { resourceUri: socialResourceUri } } }, async (input) => { const result = await createReport(userId, input); await auditMcpAction(userId, "mcp.report.create", input.target_type, input.target_id); return actionResult("Report submitted", result); });
    registerAppTool(server, "paymoment_open_conversation", { title: "Start a PayMoment DM", description: "Open or create a direct conversation with a user.", annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }, inputSchema: { user_id: z.uuid() }, _meta: { ui: { resourceUri: socialResourceUri } } }, async ({ user_id }) => { const conversation = await createDirectConversation(userId, user_id); await auditMcpAction(userId, "mcp.messages.open", "conversation", conversation.id); return actionResult("Direct conversation", conversation); });
    registerAppTool(server, "paymoment_send_dm", { title: "Send a PayMoment DM", description: "Send a message in an existing direct conversation. Ask for confirmation before sending.", annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }, inputSchema: { conversation_id: z.uuid(), body: z.string().max(5000), client_message_id: z.uuid(), reply_to_message_id: z.uuid().optional(), media_asset_ids: z.array(z.uuid()).max(4).default([]) }, _meta: { ui: { resourceUri: socialResourceUri } } }, async ({ conversation_id, body, client_message_id, reply_to_message_id, media_asset_ids }) => { const message = await sendMessage(userId, conversation_id, { body, client_message_id, reply_to_message_id, media_asset_ids }); await auditMcpAction(userId, "mcp.messages.send", "message", message.id); return actionResult("Message sent", message); });
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
