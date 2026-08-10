import {
  bigint,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { timestamps } from "./base";
import { users } from "./identity";

export const mediaStatusEnum = pgEnum("media_status", ["uploading", "ready", "failed", "deleted"]);
export const mediaPurposeEnum = pgEnum("media_purpose", ["avatar", "post", "reply", "article", "message"]);

export const mediaAssets = pgTable("media_assets", {
  id: uuid("id").defaultRandom().primaryKey(),
  ownerId: uuid("owner_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  provider: varchar("provider", { length: 32 }).default("pinata").notNull(),
  providerId: varchar("provider_id", { length: 255 }),
  cid: varchar("cid", { length: 255 }),
  gatewayUrl: text("gateway_url"),
  mimeType: varchar("mime_type", { length: 255 }).notNull(),
  extension: varchar("extension", { length: 32 }),
  byteSize: bigint("byte_size", { mode: "number" }).notNull(),
  width: integer("width"),
  height: integer("height"),
  checksumSha256: varchar("checksum_sha256", { length: 64 }).notNull(),
  altText: varchar("alt_text", { length: 500 }),
  purpose: mediaPurposeEnum("purpose").notNull(),
  status: mediaStatusEnum("status").default("uploading").notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}).notNull(),
  attachedAt: timestamp("attached_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  ...timestamps,
}, (table) => [
  index("media_assets_cid_idx").on(table.cid),
  index("media_assets_owner_status_idx").on(table.ownerId, table.status, table.createdAt),
  index("media_assets_expiry_idx").on(table.status, table.expiresAt),
]);
