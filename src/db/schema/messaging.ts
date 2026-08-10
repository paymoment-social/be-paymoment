import { sql } from "drizzle-orm";
import {
  boolean,
  index,
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
import { mediaAssets } from "./media";
import { users } from "./identity";

export const conversationTypeEnum = pgEnum("conversation_type", ["direct", "group"]);
export const conversationStatusEnum = pgEnum("conversation_status", ["active", "archived", "deleted"]);
export const conversationMemberRoleEnum = pgEnum("conversation_member_role", ["owner", "member"]);
export const conversationMemberStatusEnum = pgEnum("conversation_member_status", ["active", "left", "removed"]);
export const conversationRequestStatusEnum = pgEnum("conversation_request_status", ["pending", "accepted", "declined", "cancelled"]);
export const messageStatusEnum = pgEnum("message_status", ["sent", "deleted"]);

export const conversations = pgTable("conversations", {
  id: uuid("id").defaultRandom().primaryKey(),
  type: conversationTypeEnum("type").default("direct").notNull(),
  directKey: varchar("direct_key", { length: 73 }),
  title: varchar("title", { length: 100 }),
  avatarUrl: text("avatar_url"),
  createdById: uuid("created_by_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  status: conversationStatusEnum("status").default("active").notNull(),
  lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
  ...timestamps,
}, (table) => [
  uniqueIndex("conversations_direct_key_unique").on(table.directKey).where(sql`${table.directKey} is not null`),
  index("conversations_last_message_idx").on(table.status, table.lastMessageAt),
]);

export const conversationMembers = pgTable("conversation_members", {
  conversationId: uuid("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: conversationMemberRoleEnum("role").default("member").notNull(),
  status: conversationMemberStatusEnum("status").default("active").notNull(),
  muted: boolean("muted").default(false).notNull(),
  joinedAt: timestamp("joined_at", { withTimezone: true }).defaultNow().notNull(),
  leftAt: timestamp("left_at", { withTimezone: true }),
  lastReadMessageId: uuid("last_read_message_id"),
  lastReadAt: timestamp("last_read_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.conversationId, table.userId] }),
  index("conversation_members_user_idx").on(table.userId, table.status),
]);

export const conversationRequests = pgTable("conversation_requests", {
  id: uuid("id").defaultRandom().primaryKey(),
  requesterId: uuid("requester_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  recipientId: uuid("recipient_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  conversationId: uuid("conversation_id").references(() => conversations.id, { onDelete: "set null" }),
  status: conversationRequestStatusEnum("status").default("pending").notNull(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  ...timestamps,
}, (table) => [
  uniqueIndex("conversation_requests_open_unique").on(table.requesterId, table.recipientId).where(sql`${table.status} = 'pending'`),
  index("conversation_requests_recipient_idx").on(table.recipientId, table.status, table.createdAt),
]);

export const messages = pgTable("messages", {
  id: uuid("id").defaultRandom().primaryKey(),
  conversationId: uuid("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  senderId: uuid("sender_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  clientMessageId: varchar("client_message_id", { length: 128 }).notNull(),
  replyToMessageId: uuid("reply_to_message_id"),
  body: text("body").default("").notNull(),
  status: messageStatusEnum("status").default("sent").notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}).notNull(),
  editedAt: timestamp("edited_at", { withTimezone: true }),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  ...timestamps,
}, (table) => [
  uniqueIndex("messages_sender_client_unique").on(table.senderId, table.clientMessageId),
  index("messages_conversation_time_idx").on(table.conversationId, table.createdAt),
]);

export const messageAttachments = pgTable("message_attachments", {
  messageId: uuid("message_id").notNull().references(() => messages.id, { onDelete: "cascade" }),
  mediaAssetId: uuid("media_asset_id").notNull().references(() => mediaAssets.id, { onDelete: "restrict" }),
  position: varchar("position", { length: 8 }).default("0").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [primaryKey({ columns: [table.messageId, table.mediaAssetId] })]);

export const messageReadReceipts = pgTable("message_read_receipts", {
  messageId: uuid("message_id").notNull().references(() => messages.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  readAt: timestamp("read_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.messageId, table.userId] }),
  index("message_receipts_user_time_idx").on(table.userId, table.readAt),
]);
