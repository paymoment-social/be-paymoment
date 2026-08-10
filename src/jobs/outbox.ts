import { getQueryClient } from "../db/client";
import { publishUserEvent, type RealtimeEvent } from "../lib/websocket";
import { retryDecision } from "./retry-policy";

type OutboxRow = { id: string; topic: string; payload: { user_id?: string; event?: RealtimeEvent }; attempts: number; max_attempts: number };
let timer: ReturnType<typeof setInterval> | undefined;

export async function processOutbox(limit = 50) {
  const rows = await getQueryClient()<OutboxRow[]>`
    with claimed as (
      select id from outbox_events
      where status in ('pending', 'failed') and available_at <= now()
      order by available_at, created_at for update skip locked limit ${limit}
    ) update outbox_events set status = 'processing', attempts = attempts + 1
    where id in (select id from claimed)
    returning id, topic, payload, attempts, max_attempts`;
  for (const row of rows) {
    try {
      if (row.topic !== "realtime.user" || !row.payload.user_id || !row.payload.event) throw new Error("Unsupported outbox event.");
      await publishUserEvent(row.payload.user_id, row.payload.event.type, row.payload.event.data);
      await getQueryClient()`update outbox_events set status = 'published', processed_at = now(), last_error = null where id = ${row.id}`;
    } catch (error) {
      const decision = retryDecision(row.attempts, row.max_attempts);
      await getQueryClient()`update outbox_events set status = ${decision.status}, available_at = ${decision.nextAttemptAt ?? new Date()}, last_error = ${error instanceof Error ? error.message.slice(0, 2000) : "Outbox delivery failed."} where id = ${row.id}`;
    }
  }
  return rows.length;
}

export function startOutboxWorker() { if (!timer) timer = setInterval(() => { void processOutbox().catch((error) => console.error(JSON.stringify({ level: "error", message: "Outbox processing failed.", error: error instanceof Error ? error.message : String(error) }))); }, 1_000); }
export function stopOutboxWorker() { if (timer) clearInterval(timer); timer = undefined; }
