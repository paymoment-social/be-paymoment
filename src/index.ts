import { createApp } from "./app";
import { config } from "./config";
import { closeDatabase } from "./db/client";
import { closeRedis } from "./integrations/redis";
import { hashToken, SESSION_COOKIE } from "./modules/auth/session";
import { resolveSessionByTokenHash } from "./modules/auth/auth.repository";
import { closeRealtimeSocket, handleRealtimeSocketMessage, openRealtimeSocket, startRealtimeSubscription } from "./lib/websocket";
import { startOutboxWorker, stopOutboxWorker } from "./jobs/outbox";

const app = createApp();
function cookieValue(request: Request, name: string) { return request.headers.get("cookie")?.split(";").map((value) => value.trim()).find((value) => value.startsWith(`${name}=`))?.slice(name.length + 1); }
const server = Bun.serve<{ userId: string }>({
  port: config().port,
  fetch: async (request, bunServer) => {
    const url = new URL(request.url);
    if (url.pathname === "/api/ws" && request.headers.get("upgrade")?.toLowerCase() === "websocket") {
      const token = cookieValue(request, SESSION_COOKIE);
      const session = token ? await resolveSessionByTokenHash(hashToken(token)) : null;
      if (!session) return new Response(JSON.stringify({ error: { code: "UNAUTHENTICATED", message: "Authentication is required." } }), { status: 401, headers: { "Content-Type": "application/json" } });
      return bunServer.upgrade(request, { data: { userId: session.user.id } }) ? undefined : new Response("WebSocket upgrade failed.", { status: 400 });
    }
    return app.fetch(request);
  },
  websocket: { open: openRealtimeSocket, close: closeRealtimeSocket, message: (socket, message) => void handleRealtimeSocketMessage(socket, message) },
});
void startRealtimeSubscription().catch((error) => console.error(JSON.stringify({ level: "error", message: "Realtime Redis subscription failed.", error: error instanceof Error ? error.message : String(error) })));
startOutboxWorker();

async function shutdown(signal: string) {
  console.info(JSON.stringify({ level: "info", message: "Shutting down PayMoment API.", signal }));
  stopOutboxWorker();
  await Promise.allSettled([closeDatabase(), closeRedis()]);
  process.exit(0);
}

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));

export default server;
