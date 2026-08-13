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
} from "drizzle-orm/pg-core";
import { timestamps } from "./base";
import { posts, postReplies } from "./content";
import { conversations, messages } from "./messaging";
import { users } from "./identity";

export const notificationTypeEnum = pgEnum("notification_type", ["like", "reply", "mention", "follow", "reward", "repost", "message", "system"]);
export const rewardEntryTypeEnum = pgEnum("reward_entry_type", ["earn", "spend", "adjustment", "reversal"]);
export const rewardSourceTypeEnum = pgEnum("reward_source_type", ["moment", "catalog", "verified", "admin", "system"]);
export const entitlementTypeEnum = pgEnum("entitlement_type", ["verified", "pro"]);
export const reportTargetTypeEnum = pgEnum("report_target_type", ["user", "post", "reply", "message"]);
export const reportStatusEnum = pgEnum("report_status", ["open", "reviewing", "resolved", "dismissed"]);
export const userRoleEnum = pgEnum("user_role", ["moderator", "admin"]);
export const outboxStatusEnum = pgEnum("outbox_status", ["pending", "processing", "published", "failed", "dead_lettered"]);
export const jobStatusEnum = pgEnum("job_status", ["queued", "processing", "completed", "failed", "cancelled", "dead_lettered"]);
export const mcpClientTypeEnum = pgEnum("mcp_client_type", ["public", "confidential"]);

export const notifications = pgTable("notifications", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
  type: notificationTypeEnum("type").notNull(),
  postId: uuid("post_id").references(() => posts.id, { onDelete: "set null" }),
  replyId: uuid("reply_id").references(() => postReplies.id, { onDelete: "set null" }),
  conversationId: uuid("conversation_id").references(() => conversations.id, { onDelete: "set null" }),
  messageId: uuid("message_id").references(() => messages.id, { onDelete: "set null" }),
  dedupeKey: varchar("dedupe_key", { length: 255 }),
  payload: jsonb("payload").$type<Record<string, unknown>>().default({}).notNull(),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("notifications_dedupe_unique").on(table.userId, table.dedupeKey).where(sql`${table.dedupeKey} is not null`),
  index("notifications_user_read_time_idx").on(table.userId, table.readAt, table.createdAt),
]);

export const notificationPreferences = pgTable("notification_preferences", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  likes: boolean("likes").default(true).notNull(),
  replies: boolean("replies").default(true).notNull(),
  mentions: boolean("mentions").default(true).notNull(),
  follows: boolean("follows").default(true).notNull(),
  rewards: boolean("rewards").default(true).notNull(),
  reposts: boolean("reposts").default(true).notNull(),
  messages: boolean("messages").default(true).notNull(),
  emailDigest: boolean("email_digest").default(false).notNull(),
  ...timestamps,
});

export const rewardCatalog = pgTable("reward_catalog", {
  id: uuid("id").defaultRandom().primaryKey(),
  slug: varchar("slug", { length: 80 }).notNull(),
  title: varchar("title", { length: 120 }).notNull(),
  description: text("description").notNull(),
  costPoints: bigint("cost_points", { mode: "number" }).notNull(),
  inventory: integer("inventory"),
  active: boolean("active").default(true).notNull(),
  startsAt: timestamp("starts_at", { withTimezone: true }),
  endsAt: timestamp("ends_at", { withTimezone: true }),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}).notNull(),
  ...timestamps,
}, (table) => [
  uniqueIndex("reward_catalog_slug_unique").on(table.slug),
  check("reward_catalog_cost_nonnegative_check", sql`${table.costPoints} >= 0`),
  check("reward_catalog_inventory_nonnegative_check", sql`${table.inventory} is null or ${table.inventory} >= 0`),
]);

export const rewardLedger = pgTable("reward_ledger", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  entryType: rewardEntryTypeEnum("entry_type").notNull(),
  sourceType: rewardSourceTypeEnum("source_type").notNull(),
  amount: bigint("amount", { mode: "number" }).notNull(),
  balanceAfter: bigint("balance_after", { mode: "number" }).notNull(),
  idempotencyKey: varchar("idempotency_key", { length: 128 }).notNull(),
  sourceId: uuid("source_id"),
  description: varchar("description", { length: 255 }).notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  check("reward_ledger_amount_nonzero_check", sql`${table.amount} <> 0`),
  check("reward_ledger_balance_nonnegative_check", sql`${table.balanceAfter} >= 0`),
  uniqueIndex("reward_ledger_user_idempotency_unique").on(table.userId, table.idempotencyKey),
  index("reward_ledger_user_time_idx").on(table.userId, table.createdAt),
]);

export const rewardClaims = pgTable("reward_claims", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  postId: uuid("post_id").references(() => posts.id, { onDelete: "restrict" }),
  catalogItemId: uuid("catalog_item_id").references(() => rewardCatalog.id, { onDelete: "restrict" }),
  ledgerEntryId: uuid("ledger_entry_id").notNull().references(() => rewardLedger.id, { onDelete: "restrict" }),
  claimKey: varchar("claim_key", { length: 160 }).notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("reward_claims_user_key_unique").on(table.userId, table.claimKey),
  index("reward_claims_user_time_idx").on(table.userId, table.createdAt),
]);

export const userEntitlements = pgTable("user_entitlements", {
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  type: entitlementTypeEnum("type").notNull(),
  source: varchar("source", { length: 40 }).notNull(),
  grantedAt: timestamp("granted_at", { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.userId, table.type] }),
  index("user_entitlements_active_idx").on(table.type, table.revokedAt, table.expiresAt),
]);

export const reports = pgTable("reports", {
  id: uuid("id").defaultRandom().primaryKey(),
  reporterId: uuid("reporter_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  targetType: reportTargetTypeEnum("target_type").notNull(),
  targetId: uuid("target_id").notNull(),
  reason: varchar("reason", { length: 64 }).notNull(),
  details: text("details"),
  status: reportStatusEnum("status").default("open").notNull(),
  reviewedById: uuid("reviewed_by_id").references(() => users.id, { onDelete: "set null" }),
  resolution: text("resolution"),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  ...timestamps,
}, (table) => [
  uniqueIndex("reports_reporter_target_open_unique").on(table.reporterId, table.targetType, table.targetId).where(sql`${table.status} in ('open', 'reviewing')`),
  index("reports_status_time_idx").on(table.status, table.createdAt),
]);

export const userRoles = pgTable("user_roles", {
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: userRoleEnum("role").notNull(),
  grantedById: uuid("granted_by_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.userId, table.role] }),
  index("user_roles_role_idx").on(table.role, table.userId),
]);

export const auditLogs = pgTable("audit_logs", {
  id: uuid("id").defaultRandom().primaryKey(),
  actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  actorType: varchar("actor_type", { length: 32 }).notNull(),
  action: varchar("action", { length: 100 }).notNull(),
  entityType: varchar("entity_type", { length: 64 }).notNull(),
  entityId: uuid("entity_id"),
  requestId: varchar("request_id", { length: 64 }),
  ipHash: varchar("ip_hash", { length: 128 }),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("audit_logs_entity_idx").on(table.entityType, table.entityId, table.createdAt),
  index("audit_logs_actor_idx").on(table.actorUserId, table.createdAt),
]);

export const outboxEvents = pgTable("outbox_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  topic: varchar("topic", { length: 100 }).notNull(),
  aggregateType: varchar("aggregate_type", { length: 64 }).notNull(),
  aggregateId: uuid("aggregate_id").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  status: outboxStatusEnum("status").default("pending").notNull(),
  attempts: integer("attempts").default(0).notNull(),
  maxAttempts: integer("max_attempts").default(10).notNull(),
  availableAt: timestamp("available_at", { withTimezone: true }).defaultNow().notNull(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  check("outbox_attempts_check", sql`${table.attempts} >= 0 and ${table.maxAttempts} > 0 and ${table.attempts} <= ${table.maxAttempts}`),
  index("outbox_pending_idx").on(table.status, table.availableAt),
]);

export const backgroundJobs = pgTable("background_jobs", {
  id: uuid("id").defaultRandom().primaryKey(),
  queue: varchar("queue", { length: 64 }).notNull(),
  jobType: varchar("job_type", { length: 100 }).notNull(),
  dedupeKey: varchar("dedupe_key", { length: 160 }),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  status: jobStatusEnum("status").default("queued").notNull(),
  attempts: integer("attempts").default(0).notNull(),
  maxAttempts: integer("max_attempts").default(5).notNull(),
  availableAt: timestamp("available_at", { withTimezone: true }).defaultNow().notNull(),
  lockedAt: timestamp("locked_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  lastError: text("last_error"),
  ...timestamps,
}, (table) => [
  check("background_jobs_attempts_check", sql`${table.attempts} >= 0 and ${table.maxAttempts} > 0 and ${table.attempts} <= ${table.maxAttempts}`),
  uniqueIndex("background_jobs_dedupe_unique").on(table.queue, table.dedupeKey).where(sql`${table.dedupeKey} is not null`),
  index("background_jobs_claim_idx").on(table.queue, table.status, table.availableAt),
]);

export const trendingSnapshots = pgTable("trending_snapshots", {
  id: uuid("id").defaultRandom().primaryKey(),
  topic: varchar("topic", { length: 120 }).notNull(),
  normalizedTopic: varchar("normalized_topic", { length: 120 }).notNull(),
  window: varchar("window", { length: 16 }).notNull(),
  score: bigint("score", { mode: "number" }).notNull(),
  postCount: integer("post_count").notNull(),
  uniqueAuthorCount: integer("unique_author_count").notNull(),
  calculatedAt: timestamp("calculated_at", { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (table) => [
  uniqueIndex("trending_snapshot_topic_window_unique").on(table.normalizedTopic, table.window, table.calculatedAt),
  index("trending_snapshot_rank_idx").on(table.window, table.calculatedAt, table.score),
]);

export const mcpClients = pgTable("mcp_clients", {
  id: uuid("id").defaultRandom().primaryKey(),
  clientId: varchar("client_id", { length: 128 }).notNull(),
  clientSecretHash: varchar("client_secret_hash", { length: 128 }),
  clientType: mcpClientTypeEnum("client_type").default("public").notNull(),
  name: varchar("name", { length: 120 }).notNull(),
  redirectUris: jsonb("redirect_uris").$type<string[]>().default([]).notNull(),
  scopes: jsonb("scopes").$type<string[]>().default([]).notNull(),
  active: boolean("active").default(true).notNull(),
  ...timestamps,
}, (table) => [uniqueIndex("mcp_clients_client_id_unique").on(table.clientId)]);

export const mcpAuthorizationCodes = pgTable("mcp_authorization_codes", {
  id: uuid("id").defaultRandom().primaryKey(),
  codeHash: varchar("code_hash", { length: 128 }).notNull(),
  clientId: uuid("client_id").notNull().references(() => mcpClients.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  redirectUri: text("redirect_uri").notNull(),
  scopes: jsonb("scopes").$type<string[]>().default([]).notNull(),
  codeChallenge: varchar("code_challenge", { length: 128 }).notNull(),
  codeChallengeMethod: varchar("code_challenge_method", { length: 8 }).default("S256").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [uniqueIndex("mcp_auth_codes_hash_unique").on(table.codeHash)]);

export const mcpAccessTokens = pgTable("mcp_access_tokens", {
  id: uuid("id").defaultRandom().primaryKey(),
  tokenHash: varchar("token_hash", { length: 128 }).notNull(),
  clientId: uuid("client_id").notNull().references(() => mcpClients.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  scopes: jsonb("scopes").$type<string[]>().default([]).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("mcp_access_tokens_hash_unique").on(table.tokenHash),
  index("mcp_access_tokens_user_idx").on(table.userId, table.expiresAt),
]);

export const mcpRefreshTokens = pgTable("mcp_refresh_tokens", {
  id: uuid("id").defaultRandom().primaryKey(),
  tokenHash: varchar("token_hash", { length: 128 }).notNull(),
  accessTokenId: uuid("access_token_id").notNull().references(() => mcpAccessTokens.id, { onDelete: "cascade" }),
  familyId: uuid("family_id").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  rotatedAt: timestamp("rotated_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [uniqueIndex("mcp_refresh_tokens_hash_unique").on(table.tokenHash)]);

export const mcpConsents = pgTable("mcp_consents", {
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  clientId: uuid("client_id").notNull().references(() => mcpClients.id, { onDelete: "cascade" }),
  scopes: jsonb("scopes").$type<string[]>().default([]).notNull(),
  grantedAt: timestamp("granted_at", { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [primaryKey({ columns: [table.userId, table.clientId] })]);
