import { and, count, desc, eq, isNull, lt, or } from "drizzle-orm";
import { getDb } from "../../db/client";
import { notificationPreferences, notifications, outboxEvents } from "../../db/schema";
import { decodeCursor, encodeCursor } from "../../lib/pagination";
import { getUserProfile } from "../users/users.repository";

export async function createNotification(input: { userId: string; actorId?: string; type: "like" | "reply" | "mention" | "follow" | "reward" | "repost" | "message" | "system"; postId?: string; replyId?: string; conversationId?: string; messageId?: string; dedupeKey?: string; payload?: Record<string, unknown> }) {
  if (input.userId === input.actorId) return null;
  const preferenceColumn = input.type === "like" ? "likes" : input.type === "reply" ? "replies" : input.type === "mention" ? "mentions" : input.type === "follow" ? "follows" : input.type === "reward" ? "rewards" : input.type === "repost" ? "reposts" : input.type === "message" ? "messages" : null;
  if (preferenceColumn) { const [preferences] = await getDb().select().from(notificationPreferences).where(eq(notificationPreferences.userId, input.userId)).limit(1); if (preferences && !preferences[preferenceColumn]) return null; }
  const created = await getDb().transaction(async (tx) => {
    const [notification] = await tx.insert(notifications).values({ userId: input.userId, actorId: input.actorId, type: input.type, postId: input.postId, replyId: input.replyId, conversationId: input.conversationId, messageId: input.messageId, dedupeKey: input.dedupeKey, payload: input.payload ?? {} }).onConflictDoNothing().returning();
    if (!notification) return null;
    await tx.insert(outboxEvents).values({ topic: "realtime.user", aggregateType: "notification", aggregateId: notification.id, payload: { user_id: notification.userId, event: { type: "notification.created", data: { notification_id: notification.id }, occurred_at: new Date().toISOString() } } });
    return notification;
  });
  if (!created) return null;
  const data = { id: created.id, type: created.type, actor: created.actorId ? await getUserProfile(created.actorId, created.userId) : null, post_id: created.postId, reply_id: created.replyId, conversation_id: created.conversationId, message_id: created.messageId, payload: created.payload, read_at: null, created_at: created.createdAt.toISOString() };
  return data;
}

export async function listNotifications(userId: string, filter: string, limit: number, cursorValue?: string) {
  const cursor = decodeCursor(cursorValue);
  const type = filter === "likes" ? "like" : filter === "replies" ? "reply" : filter === "mentions" ? "mention" : filter === "follows" ? "follow" : filter === "rewards" ? "reward" : undefined;
  const rows = await getDb().select().from(notifications).where(and(eq(notifications.userId, userId), filter === "unread" ? isNull(notifications.readAt) : undefined, type ? eq(notifications.type, type) : undefined, cursor ? or(lt(notifications.createdAt, new Date(cursor.created_at)), and(eq(notifications.createdAt, new Date(cursor.created_at)), lt(notifications.id, cursor.id))) : undefined)).orderBy(desc(notifications.createdAt), desc(notifications.id)).limit(limit + 1);
  const page = rows.slice(0, limit);
  const data = await Promise.all(page.map(async (row) => ({ id: row.id, type: row.type, actor: row.actorId ? await getUserProfile(row.actorId, userId) : null, post_id: row.postId, reply_id: row.replyId, conversation_id: row.conversationId, message_id: row.messageId, payload: row.payload, read_at: row.readAt?.toISOString() ?? null, created_at: row.createdAt.toISOString() })));
  const last = page.at(-1);
  return { data, hasMore: rows.length > limit, nextCursor: rows.length > limit && last ? encodeCursor({ created_at: last.createdAt.toISOString(), id: last.id }) : null };
}

export async function markNotificationRead(userId: string, id: string) {
  const [row] = await getDb().update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.id, id), eq(notifications.userId, userId))).returning({ id: notifications.id, readAt: notifications.readAt });
  return row ?? null;
}

export async function markAllNotificationsRead(userId: string) {
  const rows = await getDb().update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.userId, userId), isNull(notifications.readAt))).returning({ id: notifications.id });
  return rows.length;
}
export async function getUnreadNotificationCount(userId: string) { const [row] = await getDb().select({ count: count() }).from(notifications).where(and(eq(notifications.userId, userId), isNull(notifications.readAt))); return row?.count ?? 0; }
export async function getNotificationPreferences(userId: string) { const [row] = await getDb().select().from(notificationPreferences).where(eq(notificationPreferences.userId, userId)).limit(1); return row ?? { userId, likes: true, replies: true, mentions: true, follows: true, rewards: true, reposts: true, messages: true, emailDigest: false }; }
export async function updateNotificationPreferences(userId: string, input: { likes?: boolean; replies?: boolean; mentions?: boolean; follows?: boolean; rewards?: boolean; reposts?: boolean; messages?: boolean; email_digest?: boolean }) { const [row] = await getDb().insert(notificationPreferences).values({ userId, likes: input.likes ?? true, replies: input.replies ?? true, mentions: input.mentions ?? true, follows: input.follows ?? true, rewards: input.rewards ?? true, reposts: input.reposts ?? true, messages: input.messages ?? true, emailDigest: input.email_digest ?? false }).onConflictDoUpdate({ target: notificationPreferences.userId, set: { ...(input.likes !== undefined ? { likes: input.likes } : {}), ...(input.replies !== undefined ? { replies: input.replies } : {}), ...(input.mentions !== undefined ? { mentions: input.mentions } : {}), ...(input.follows !== undefined ? { follows: input.follows } : {}), ...(input.rewards !== undefined ? { rewards: input.rewards } : {}), ...(input.reposts !== undefined ? { reposts: input.reposts } : {}), ...(input.messages !== undefined ? { messages: input.messages } : {}), ...(input.email_digest !== undefined ? { emailDigest: input.email_digest } : {}), updatedAt: new Date() } }).returning(); return row!; }
