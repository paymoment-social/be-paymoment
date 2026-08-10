import { and, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { getDb } from "../../db/client";
import { conversationMembers, conversationRequests, conversations, mediaAssets, messageAttachments, messages } from "../../db/schema";
import { AppError } from "../../lib/errors";
import { publishUserEvent } from "../../lib/websocket";
import { decodeCursor, encodeCursor } from "../../lib/pagination";
import { getUserProfile, isBlockedByUser } from "../users/users.repository";
import { createNotification } from "../notifications/notifications.repository";

function directKey(a: string, b: string) { return [a, b].sort().join(":"); }
export async function requireMembership(userId: string, conversationId: string) { const [member] = await getDb().select().from(conversationMembers).where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, userId), eq(conversationMembers.status, "active"))).limit(1); if (!member) throw new AppError(404, "NOT_FOUND", "The conversation was not found."); return member; }
export async function createDirectConversation(userId: string, recipientId: string) {
  if (userId === recipientId) throw new AppError(422, "BUSINESS_RULE_ERROR", "You cannot create a conversation with yourself.");
  const [recipient, blockedByRecipient, blockedBySender] = await Promise.all([getUserProfile(recipientId, userId), isBlockedByUser(recipientId, userId), isBlockedByUser(userId, recipientId)]);
  if (!recipient || blockedByRecipient || blockedBySender) throw new AppError(404, "NOT_FOUND", "The recipient was not found.");
  if (!recipient.privacy.allow_messages) throw new AppError(403, "FORBIDDEN", "This user is not accepting messages.");
  const key = directKey(userId, recipientId);
  return getDb().transaction(async (tx) => { const [existing] = await tx.select().from(conversations).where(eq(conversations.directKey, key)).limit(1); if (existing) return existing; const [conversation] = await tx.insert(conversations).values({ type: "direct", directKey: key, createdById: userId }).returning(); await tx.insert(conversationMembers).values([{ conversationId: conversation!.id, userId, role: "owner" }, { conversationId: conversation!.id, userId: recipientId, role: "member" }]); return conversation!; });
}
export async function createMessageRequest(userId: string, recipientId: string) {
  if (userId === recipientId) throw new AppError(422, "BUSINESS_RULE_ERROR", "You cannot send a message request to yourself.");
  const [recipient, blockedByRecipient, blockedBySender] = await Promise.all([getUserProfile(recipientId, userId), isBlockedByUser(recipientId, userId), isBlockedByUser(userId, recipientId)]);
  if (!recipient || blockedByRecipient || blockedBySender) throw new AppError(404, "NOT_FOUND", "The recipient was not found.");
  if (!recipient.privacy.allow_messages) throw new AppError(403, "FORBIDDEN", "This user is not accepting messages.");
  const [request] = await getDb().insert(conversationRequests).values({ requesterId: userId, recipientId }).onConflictDoNothing().returning();
  if (!request) throw new AppError(409, "CONFLICT", "You already have a pending message request for this user.");
  await createNotification({ userId: recipientId, actorId: userId, type: "message", dedupeKey: `message-request:${request.id}`, payload: { message_request_id: request.id, action: "requested" } });
  return { id: request.id, recipient_id: request.recipientId, status: request.status, created_at: request.createdAt.toISOString() };
}
export async function listIncomingMessageRequests(userId: string) {
  const rows = await getDb().select().from(conversationRequests).where(and(eq(conversationRequests.recipientId, userId), eq(conversationRequests.status, "pending"))).orderBy(desc(conversationRequests.createdAt)).limit(100);
  return Promise.all(rows.map(async (request) => ({ id: request.id, status: request.status, requester: await getUserProfile(request.requesterId, userId), created_at: request.createdAt.toISOString() })));
}
export async function respondToMessageRequest(userId: string, requestId: string, decision: "accept" | "decline") {
  const [request] = await getDb().select().from(conversationRequests).where(and(eq(conversationRequests.id, requestId), eq(conversationRequests.recipientId, userId), eq(conversationRequests.status, "pending"))).limit(1);
  if (!request) throw new AppError(404, "NOT_FOUND", "The message request was not found.");
  const conversation = decision === "accept" ? await createDirectConversation(userId, request.requesterId) : null;
  const [updated] = await getDb().update(conversationRequests).set({ status: decision === "accept" ? "accepted" : "declined", conversationId: conversation?.id ?? null, resolvedAt: new Date(), updatedAt: new Date() }).where(eq(conversationRequests.id, request.id)).returning();
  await createNotification({ userId: request.requesterId, actorId: userId, type: "message", conversationId: conversation?.id, dedupeKey: `message-request:${request.id}:${decision}`, payload: { message_request_id: request.id, action: decision } });
  return { id: updated!.id, status: updated!.status, conversation_id: updated!.conversationId };
}
export async function listConversations(userId: string) {
  const rows = await getDb().select({ id: conversations.id, type: conversations.type, title: conversations.title, lastMessageAt: conversations.lastMessageAt, updatedAt: conversations.updatedAt, lastReadAt: conversationMembers.lastReadAt }).from(conversationMembers).innerJoin(conversations, eq(conversations.id, conversationMembers.conversationId)).where(and(eq(conversationMembers.userId, userId), eq(conversationMembers.status, "active"), eq(conversations.status, "active"))).orderBy(desc(conversations.lastMessageAt), desc(conversations.updatedAt));
  return Promise.all(rows.map(async (row) => {
    const [participant, latest] = await Promise.all([
      getDb().select({ userId: conversationMembers.userId }).from(conversationMembers).where(and(eq(conversationMembers.conversationId, row.id), eq(conversationMembers.status, "active"), sql`${conversationMembers.userId} <> ${userId}`)).limit(1),
      getDb().select().from(messages).where(and(eq(messages.conversationId, row.id), isNull(messages.deletedAt))).orderBy(desc(messages.createdAt), desc(messages.id)).limit(1),
    ]);
    return { ...row, participant: participant[0] ? await getUserProfile(participant[0].userId, userId) : null, unread: Boolean(latest[0] && latest[0].senderId !== userId && (!row.lastReadAt || latest[0].createdAt > row.lastReadAt)), last_message: latest[0] ? { id: latest[0].id, sender_id: latest[0].senderId, body: latest[0].body, created_at: latest[0].createdAt.toISOString() } : null };
  }));
}
async function hydrateMessage(message: typeof messages.$inferSelect) {
  const attachments = await getDb().select({ id: mediaAssets.id, url: mediaAssets.gatewayUrl, mime_type: mediaAssets.mimeType, alt_text: mediaAssets.altText, position: messageAttachments.position }).from(messageAttachments).innerJoin(mediaAssets, eq(mediaAssets.id, messageAttachments.mediaAssetId)).where(eq(messageAttachments.messageId, message.id)).orderBy(messageAttachments.position);
  return { id: message.id, conversation_id: message.conversationId, sender_id: message.senderId, body: message.body, reply_to_message_id: message.replyToMessageId, created_at: message.createdAt.toISOString(), attachments };
}
export async function listMessages(userId: string, conversationId: string, limit: number, cursorValue?: string) { await requireMembership(userId, conversationId); const cursor = decodeCursor(cursorValue); const rows = await getDb().select().from(messages).where(and(eq(messages.conversationId, conversationId), isNull(messages.deletedAt), cursor ? or(lt(messages.createdAt, new Date(cursor.created_at)), and(eq(messages.createdAt, new Date(cursor.created_at)), lt(messages.id, cursor.id))) : undefined)).orderBy(desc(messages.createdAt), desc(messages.id)).limit(limit + 1); const page = rows.slice(0, limit); const last = page.at(-1); return { data: await Promise.all(page.map(hydrateMessage)), hasMore: rows.length > limit, nextCursor: rows.length > limit && last ? encodeCursor({ created_at: last.createdAt.toISOString(), id: last.id }) : null }; }
export async function sendMessage(userId: string, conversationId: string, input: { body: string; client_message_id: string; reply_to_message_id?: string; media_asset_ids: string[] }) { await requireMembership(userId, conversationId); const message = await getDb().transaction(async (tx) => { const [existing] = await tx.select().from(messages).where(and(eq(messages.senderId, userId), eq(messages.clientMessageId, input.client_message_id))).limit(1); if (existing) return existing; if (input.media_asset_ids.length) { const assets = await tx.select({ id: mediaAssets.id }).from(mediaAssets).where(and(inArray(mediaAssets.id, input.media_asset_ids), eq(mediaAssets.ownerId, userId), eq(mediaAssets.purpose, "message"), eq(mediaAssets.status, "ready"), isNull(mediaAssets.deletedAt))); if (assets.length !== new Set(input.media_asset_ids).size) throw new AppError(422, "VALIDATION_ERROR", "One or more message attachments are invalid.", { media_asset_ids: "Upload valid message attachments first." }); }
    const [created] = await tx.insert(messages).values({ conversationId, senderId: userId, clientMessageId: input.client_message_id, body: input.body, replyToMessageId: input.reply_to_message_id }).returning();
    if (input.media_asset_ids.length) { await tx.insert(messageAttachments).values(input.media_asset_ids.map((mediaAssetId, index) => ({ messageId: created!.id, mediaAssetId, position: String(index) }))); await tx.update(mediaAssets).set({ attachedAt: new Date(), expiresAt: null, updatedAt: new Date() }).where(inArray(mediaAssets.id, input.media_asset_ids)); }
    await tx.update(conversations).set({ lastMessageAt: created!.createdAt, updatedAt: new Date() }).where(eq(conversations.id, conversationId)); return created!;
  });
  const hydrated = await hydrateMessage(message);
  const members = await getDb().select({ userId: conversationMembers.userId }).from(conversationMembers).where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.status, "active")));
  await Promise.all(members.filter((member) => member.userId !== userId).map(async (member) => { await publishUserEvent(member.userId, "message.created", { conversation_id: conversationId, message: hydrated }); await createNotification({ userId: member.userId, actorId: userId, type: "message", conversationId, messageId: message.id, dedupeKey: `message:${message.id}` }); }));
  return hydrated;
}
export async function markConversationRead(userId: string, conversationId: string) { await requireMembership(userId, conversationId); const [latest] = await getDb().select({ id: messages.id }).from(messages).where(and(eq(messages.conversationId, conversationId), isNull(messages.deletedAt))).orderBy(desc(messages.createdAt), desc(messages.id)).limit(1); await getDb().update(conversationMembers).set({ lastReadMessageId: latest?.id ?? null, lastReadAt: new Date(), updatedAt: new Date() }).where(and(eq(conversationMembers.userId, userId), eq(conversationMembers.conversationId, conversationId))); const members = await getDb().select({ userId: conversationMembers.userId }).from(conversationMembers).where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.status, "active"))); await Promise.all(members.filter((member) => member.userId !== userId).map((member) => publishUserEvent(member.userId, "message.read", { conversation_id: conversationId, user_id: userId, last_read_message_id: latest?.id ?? null }))); return { conversation_id: conversationId, last_read_message_id: latest?.id ?? null }; }
