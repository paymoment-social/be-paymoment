import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
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

export const userStatusEnum = pgEnum("user_status", ["active", "suspended", "deleted"]);
export const oauthProviderEnum = pgEnum("oauth_provider", ["google"]);
export const relationshipStatusEnum = pgEnum("relationship_status", ["pending", "active", "removed"]);

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: varchar("email", { length: 320 }).notNull(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  displayName: varchar("display_name", { length: 80 }).notNull(),
  username: varchar("username", { length: 30 }),
  usernameNormalized: varchar("username_normalized", { length: 30 }),
  avatarUrl: text("avatar_url"),
  status: userStatusEnum("status").default("active").notNull(),
  onboardingCompleted: boolean("onboarding_completed").default(false).notNull(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  ...timestamps,
}, (table) => [
  uniqueIndex("users_email_unique").on(sql`lower(${table.email})`),
  uniqueIndex("users_username_normalized_unique").on(table.usernameNormalized),
  index("users_status_idx").on(table.status),
]);

export const oauthAccounts = pgTable("oauth_accounts", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  provider: oauthProviderEnum("provider").notNull(),
  providerAccountId: varchar("provider_account_id", { length: 255 }).notNull(),
  accessTokenEncrypted: text("access_token_encrypted"),
  refreshTokenEncrypted: text("refresh_token_encrypted"),
  tokenKeyVersion: varchar("token_key_version", { length: 32 }),
  tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
  ...timestamps,
}, (table) => [
  uniqueIndex("oauth_provider_account_unique").on(table.provider, table.providerAccountId),
  index("oauth_accounts_user_idx").on(table.userId),
]);

export const sessions = pgTable("sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: varchar("token_hash", { length: 128 }).notNull(),
  userAgent: text("user_agent"),
  ipHash: varchar("ip_hash", { length: 128 }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }).defaultNow().notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  ...timestamps,
}, (table) => [
  uniqueIndex("sessions_token_hash_unique").on(table.tokenHash),
  index("sessions_user_expiry_idx").on(table.userId, table.expiresAt),
]);

export const userProfiles = pgTable("user_profiles", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  bio: varchar("bio", { length: 160 }).default("").notNull(),
  birthDate: date("birth_date"),
  location: varchar("location", { length: 120 }),
  websiteUrl: text("website_url"),
  podcastUrl: text("podcast_url"),
  showPayboxBadge: boolean("show_paybox_badge").default(true).notNull(),
  showRecentViews: boolean("show_recent_views").default(true).notNull(),
  privateProfile: boolean("private_profile").default(false).notNull(),
  allowMessages: boolean("allow_messages").default(true).notNull(),
  ...timestamps,
});

export const interests = pgTable("interests", {
  id: uuid("id").defaultRandom().primaryKey(),
  slug: varchar("slug", { length: 80 }).notNull(),
  label: varchar("label", { length: 80 }).notNull(),
  active: boolean("active").default(true).notNull(),
  ...timestamps,
}, (table) => [uniqueIndex("interests_slug_unique").on(table.slug)]);

export const userInterests = pgTable("user_interests", {
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  interestId: uuid("interest_id").notNull().references(() => interests.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.userId, table.interestId] }),
  index("user_interests_interest_idx").on(table.interestId),
]);

export const usernameHistory = pgTable("username_history", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  username: varchar("username", { length: 30 }).notNull(),
  usernameNormalized: varchar("username_normalized", { length: 30 }).notNull(),
  releasedAt: timestamp("released_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("username_history_user_idx").on(table.userId, table.createdAt),
  index("username_history_normalized_idx").on(table.usernameNormalized),
]);

export const follows = pgTable("follows", {
  followerId: uuid("follower_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  followingId: uuid("following_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  status: relationshipStatusEnum("status").default("active").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.followerId, table.followingId] }),
  check("follows_not_self_check", sql`${table.followerId} <> ${table.followingId}`),
  index("follows_following_idx").on(table.followingId, table.status),
]);

export const userBlocks = pgTable("user_blocks", {
  blockerId: uuid("blocker_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  blockedId: uuid("blocked_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.blockerId, table.blockedId] }),
  check("user_blocks_not_self_check", sql`${table.blockerId} <> ${table.blockedId}`),
  index("user_blocks_blocked_idx").on(table.blockedId),
]);

export const userMutes = pgTable("user_mutes", {
  muterId: uuid("muter_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  mutedId: uuid("muted_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.muterId, table.mutedId] }),
  check("user_mutes_not_self_check", sql`${table.muterId} <> ${table.mutedId}`),
  index("user_mutes_muted_idx").on(table.mutedId),
]);

export const policyConsents = pgTable("policy_consents", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  policyType: varchar("policy_type", { length: 32 }).notNull(),
  policyVersion: varchar("policy_version", { length: 32 }).notNull(),
  ipHash: varchar("ip_hash", { length: 128 }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("policy_consents_unique").on(table.userId, table.policyType, table.policyVersion),
]);
