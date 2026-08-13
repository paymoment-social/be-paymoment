import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { timestamps } from "./base";
import { users } from "./identity";
import { mediaAssets } from "./media";

export const postKindEnum = pgEnum("post_kind", ["moment", "quote", "article", "poll"]);
export const contentStatusEnum = pgEnum("content_status", ["draft", "published", "deleted", "moderated"]);
export const visibilityEnum = pgEnum("visibility", ["public", "followers", "private"]);
export const articleStatusEnum = pgEnum("article_status", ["draft", "published", "archived"]);
export const pollStatusEnum = pgEnum("poll_status", ["open", "closed"]);
export const voterVisibilityEnum = pgEnum("voter_visibility", ["public", "anonymous"]);
export const actorTypeEnum = pgEnum("actor_type", ["human", "mcp_agent", "system", "admin"]);

export const posts = pgTable("posts", {
  id: uuid("id").defaultRandom().primaryKey(),
  authorId: uuid("author_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  kind: postKindEnum("kind").default("moment").notNull(),
  body: varchar("body", { length: 500 }).default("").notNull(),
  visibility: visibilityEnum("visibility").default("public").notNull(),
  status: contentStatusEnum("status").default("published").notNull(),
  quotedPostId: uuid("quoted_post_id").references((): AnyPgColumn => posts.id, { onDelete: "set null" }),
  actorType: actorTypeEnum("actor_type").default("human").notNull(),
  actorClientId: uuid("actor_client_id"),
  version: integer("version").default(1).notNull(),
  likeCount: integer("like_count").default(0).notNull(),
  replyCount: integer("reply_count").default(0).notNull(),
  repostCount: integer("repost_count").default(0).notNull(),
  bookmarkCount: integer("bookmark_count").default(0).notNull(),
  viewCount: bigint("view_count", { mode: "number" }).default(0).notNull(),
  publishedAt: timestamp("published_at", { withTimezone: true }).defaultNow(),
  pinnedAt: timestamp("pinned_at", { withTimezone: true }),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  ...timestamps,
}, (table) => [
  check("posts_version_positive_check", sql`${table.version} > 0`),
  check("posts_counts_nonnegative_check", sql`${table.likeCount} >= 0 and ${table.replyCount} >= 0 and ${table.repostCount} >= 0 and ${table.bookmarkCount} >= 0 and ${table.viewCount} >= 0`),
  index("posts_feed_idx").on(table.status, table.visibility, table.publishedAt, table.id),
  index("posts_author_idx").on(table.authorId, table.status, table.publishedAt),
  index("posts_quote_idx").on(table.quotedPostId),
]);

export const postMedia = pgTable("post_media", {
  postId: uuid("post_id").notNull().references(() => posts.id, { onDelete: "cascade" }),
  mediaAssetId: uuid("media_asset_id").notNull().references(() => mediaAssets.id, { onDelete: "restrict" }),
  position: integer("position").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  check("post_media_position_nonnegative_check", sql`${table.position} >= 0`),
  primaryKey({ columns: [table.postId, table.mediaAssetId] }),
  uniqueIndex("post_media_position_unique").on(table.postId, table.position),
]);

export const hashtags = pgTable("hashtags", {
  id: uuid("id").defaultRandom().primaryKey(),
  slug: varchar("slug", { length: 100 }).notNull(),
  displayLabel: varchar("display_label", { length: 100 }).notNull(),
  postCount: bigint("post_count", { mode: "number" }).default(0).notNull(),
  ...timestamps,
}, (table) => [uniqueIndex("hashtags_slug_unique").on(table.slug)]);

export const postHashtags = pgTable("post_hashtags", {
  postId: uuid("post_id").notNull().references(() => posts.id, { onDelete: "cascade" }),
  hashtagId: uuid("hashtag_id").notNull().references(() => hashtags.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.postId, table.hashtagId] }),
  index("post_hashtags_hashtag_idx").on(table.hashtagId, table.createdAt),
]);

export const postMentions = pgTable("post_mentions", {
  postId: uuid("post_id").notNull().references(() => posts.id, { onDelete: "cascade" }),
  mentionedUserId: uuid("mentioned_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.postId, table.mentionedUserId] }),
  index("post_mentions_user_idx").on(table.mentionedUserId, table.createdAt),
]);

export const articles = pgTable("articles", {
  postId: uuid("post_id").primaryKey().references(() => posts.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 120 }).notNull(),
  eyebrow: varchar("eyebrow", { length: 80 }),
  description: varchar("description", { length: 300 }).notNull(),
  contentHtml: text("content_html").notNull(),
  contentText: text("content_text").notNull(),
  bannerMediaId: uuid("banner_media_id").references(() => mediaAssets.id, { onDelete: "set null" }),
  bannerColor: varchar("banner_color", { length: 16 }).default("#17181B").notNull(),
  bannerPosition: varchar("banner_position", { length: 16 }).default("center").notNull(),
  status: articleStatusEnum("status").default("draft").notNull(),
  draftVersion: integer("draft_version").default(1).notNull(),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  ...timestamps,
}, (table) => [index("articles_scheduled_at_idx").on(table.status, table.scheduledAt)]);

export const polls = pgTable("polls", {
  postId: uuid("post_id").primaryKey().references(() => posts.id, { onDelete: "cascade" }),
  question: varchar("question", { length: 160 }).notNull(),
  status: pollStatusEnum("status").default("open").notNull(),
  voterVisibility: voterVisibilityEnum("voter_visibility").default("public").notNull(),
  allowVoteChange: boolean("allow_vote_change").default(true).notNull(),
  totalVotes: integer("total_votes").default(0).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  ...timestamps,
});

export const pollOptions = pgTable("poll_options", {
  id: uuid("id").defaultRandom().primaryKey(),
  pollId: uuid("poll_id").notNull().references(() => polls.postId, { onDelete: "cascade" }),
  label: varchar("label", { length: 80 }).notNull(),
  position: integer("position").notNull(),
  voteCount: integer("vote_count").default(0).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  check("poll_options_position_nonnegative_check", sql`${table.position} >= 0`),
  check("poll_options_votes_nonnegative_check", sql`${table.voteCount} >= 0`),
  uniqueIndex("poll_options_position_unique").on(table.pollId, table.position),
]);

export const pollVotes = pgTable("poll_votes", {
  pollId: uuid("poll_id").notNull().references(() => polls.postId, { onDelete: "cascade" }),
  optionId: uuid("option_id").notNull().references(() => pollOptions.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.pollId, table.userId] }),
  index("poll_votes_option_idx").on(table.optionId, table.createdAt),
]);

export const postReplies = pgTable("post_replies", {
  id: uuid("id").defaultRandom().primaryKey(),
  postId: uuid("post_id").notNull().references(() => posts.id, { onDelete: "cascade" }),
  authorId: uuid("author_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  parentId: uuid("parent_id").references((): AnyPgColumn => postReplies.id, { onDelete: "set null" }),
  body: varchar("body", { length: 500 }).notNull(),
  status: contentStatusEnum("status").default("published").notNull(),
  actorType: actorTypeEnum("actor_type").default("human").notNull(),
  likeCount: integer("like_count").default(0).notNull(),
  replyCount: integer("reply_count").default(0).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  ...timestamps,
}, (table) => [
  check("post_replies_counts_nonnegative_check", sql`${table.likeCount} >= 0 and ${table.replyCount} >= 0`),
  index("post_replies_post_parent_idx").on(table.postId, table.parentId, table.createdAt, table.id),
  index("post_replies_author_idx").on(table.authorId, table.createdAt),
]);

export const replyMedia = pgTable("reply_media", {
  replyId: uuid("reply_id").notNull().references(() => postReplies.id, { onDelete: "cascade" }),
  mediaAssetId: uuid("media_asset_id").notNull().references(() => mediaAssets.id, { onDelete: "restrict" }),
  position: integer("position").default(0).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  check("reply_media_position_nonnegative_check", sql`${table.position} >= 0`),
  primaryKey({ columns: [table.replyId, table.mediaAssetId] }),
  uniqueIndex("reply_media_position_unique").on(table.replyId, table.position),
]);

export const replyMentions = pgTable("reply_mentions", {
  replyId: uuid("reply_id").notNull().references(() => postReplies.id, { onDelete: "cascade" }),
  mentionedUserId: uuid("mentioned_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.replyId, table.mentionedUserId] }),
  index("reply_mentions_user_idx").on(table.mentionedUserId, table.createdAt),
]);

export const postLikes = pgTable("post_likes", {
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  postId: uuid("post_id").notNull().references(() => posts.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [primaryKey({ columns: [table.userId, table.postId] })]);

export const replyLikes = pgTable("reply_likes", {
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  replyId: uuid("reply_id").notNull().references(() => postReplies.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [primaryKey({ columns: [table.userId, table.replyId] })]);

export const reposts = pgTable("reposts", {
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  postId: uuid("post_id").notNull().references(() => posts.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.userId, table.postId] }),
  index("reposts_post_idx").on(table.postId, table.createdAt),
]);

export const bookmarks = pgTable("bookmarks", {
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  postId: uuid("post_id").notNull().references(() => posts.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.userId, table.postId] }),
  index("bookmarks_user_time_idx").on(table.userId, table.createdAt, table.postId),
]);

export const postViews = pgTable("post_views", {
  id: uuid("id").defaultRandom().primaryKey(),
  postId: uuid("post_id").notNull().references(() => posts.id, { onDelete: "cascade" }),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  viewerHash: varchar("viewer_hash", { length: 128 }).notNull(),
  viewedAt: timestamp("viewed_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("post_views_post_time_idx").on(table.postId, table.viewedAt),
  uniqueIndex("post_views_dedupe_unique").on(table.postId, table.viewerHash),
]);

export const postShares = pgTable("post_shares", {
  id: uuid("id").defaultRandom().primaryKey(),
  postId: uuid("post_id").notNull().references(() => posts.id, { onDelete: "cascade" }),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  channel: varchar("channel", { length: 32 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index("post_shares_post_time_idx").on(table.postId, table.createdAt)]);

export const feedImpressions = pgTable("feed_impressions", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  postId: uuid("post_id").notNull().references(() => posts.id, { onDelete: "cascade" }),
  feedMode: varchar("feed_mode", { length: 32 }).notNull(),
  rankingVersion: varchar("ranking_version", { length: 32 }).notNull(),
  score: integer("score"),
  context: jsonb("context").$type<Record<string, unknown>>().default({}).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("feed_impressions_user_time_idx").on(table.userId, table.createdAt),
  index("feed_impressions_post_time_idx").on(table.postId, table.createdAt),
]);
