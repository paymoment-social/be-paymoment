import type { ServerWebSocket } from "bun";
import { and, eq } from "drizzle-orm";
import { getDb } from "../db/client";
import { conversationMembers } from "../db/schema";
import { getRedisPublisher, getRedisSubscriber } from "../integrations/redis/client";
import { redisKeys } from "../integrations/redis/keys";

export type RealtimeEvent = { type: "message.created" | "message.read" | "message.requested" | "conversation.updated" | "notification.created" | "presence.updated" | "typing.updated"; data: Record<string, unknown>; occurred_at: string };
type SocketData = { userId: string };
const sockets = new Map<string, Set<ServerWebSocket<SocketData>>>();
let subscribed = false;

function send(socket: ServerWebSocket<SocketData>, event: RealtimeEvent) { socket.send(JSON.stringify(event)); }
function deliver(userId: string, event: RealtimeEvent) { sockets.get(userId)?.forEach((socket) => send(socket, event)); }

export async function startRealtimeSubscription() {
  if (subscribed) return;
  const subscriber = getRedisSubscriber();
  subscriber.on("pmessage", (_pattern, _channel, payload) => { try { const message = JSON.parse(payload) as { user_id: string; event: RealtimeEvent }; deliver(message.user_id, message.event); } catch { /* malformed external pub/sub payloads are ignored */ } });
  await subscriber.psubscribe(redisKeys.websocketPattern());
  subscribed = true;
}

export async function publishUserEvent(userId: string, type: RealtimeEvent["type"], data: Record<string, unknown>) {
  const event: RealtimeEvent = { type, data, occurred_at: new Date().toISOString() };
  await getRedisPublisher().publish(redisKeys.websocketChannel(userId), JSON.stringify({ user_id: userId, event }));
}

export function openRealtimeSocket(socket: ServerWebSocket<SocketData>) {
  const set = sockets.get(socket.data.userId) ?? new Set<ServerWebSocket<SocketData>>(); set.add(socket); sockets.set(socket.data.userId, set);
  send(socket, { type: "presence.updated", data: { user_id: socket.data.userId, status: "connected" }, occurred_at: new Date().toISOString() });
}
export function closeRealtimeSocket(socket: ServerWebSocket<SocketData>) { const set = sockets.get(socket.data.userId); if (!set) return; set.delete(socket); if (!set.size) sockets.delete(socket.data.userId); }

type ClientRealtimeCommand =
  | { type: "typing.set"; conversation_id: string; is_typing: boolean }
  | { type: "presence.set"; conversation_id: string; status: "available" | "away" };

function parseClientCommand(message: string | Buffer): ClientRealtimeCommand | null {
  try {
    const value = JSON.parse(String(message)) as Record<string, unknown>;
    if (typeof value.conversation_id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.conversation_id)) return null;
    if (value.type === "typing.set" && typeof value.is_typing === "boolean") return { type: value.type, conversation_id: value.conversation_id, is_typing: value.is_typing };
    if (value.type === "presence.set" && (value.status === "available" || value.status === "away")) return { type: value.type, conversation_id: value.conversation_id, status: value.status };
    return null;
  } catch { return null; }
}

export async function handleRealtimeSocketMessage(socket: ServerWebSocket<SocketData>, message: string | Buffer) {
  const command = parseClientCommand(message);
  if (!command) return;
  const members = await getDb().select({ userId: conversationMembers.userId }).from(conversationMembers).where(and(
    eq(conversationMembers.conversationId, command.conversation_id),
    eq(conversationMembers.status, "active"),
  ));
  if (!members.some((member) => member.userId === socket.data.userId)) return;
  const data = command.type === "typing.set"
    ? { conversation_id: command.conversation_id, user_id: socket.data.userId, is_typing: command.is_typing }
    : { conversation_id: command.conversation_id, user_id: socket.data.userId, status: command.status };
  const event = command.type === "typing.set" ? "typing.updated" : "presence.updated";
  await Promise.all(members.filter((member) => member.userId !== socket.data.userId).map((member) => publishUserEvent(member.userId, event, data)));
}
