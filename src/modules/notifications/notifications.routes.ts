import { Hono } from "hono";
import { enforceRateLimit } from "../../lib/rate-limit";
import { AppError } from "../../lib/errors";
import { paginated, success } from "../../lib/responses";
import { parseJson, parseQuery } from "../../lib/validation";
import { requireSession } from "../auth/auth.service";
import { getNotificationPreferences, getUnreadNotificationCount, listNotifications, markAllNotificationsRead, markNotificationRead, updateNotificationPreferences } from "./notifications.repository";
import { notificationIdSchema, notificationPreferencesSchema, notificationsQuerySchema } from "./notifications.schemas";

export const notificationsRoutes = new Hono();
notificationsRoutes.get("/preferences", async (c) => { const session = await requireSession(c); return success(c, { preferences: await getNotificationPreferences(session.user.id) }); });
notificationsRoutes.get("/unread-count", async (c) => { const session = await requireSession(c); return success(c, { count: await getUnreadNotificationCount(session.user.id) }); });
notificationsRoutes.put("/preferences", async (c) => { const session = await requireSession(c); await enforceRateLimit(c, "notifications.preferences", session.user.id, 30, 60 * 60); return success(c, { preferences: await updateNotificationPreferences(session.user.id, await parseJson(c, notificationPreferencesSchema)) }); });
notificationsRoutes.get("/", async (c) => { const session = await requireSession(c); const query = parseQuery(c, notificationsQuerySchema); const page = await listNotifications(session.user.id, query.filter, query.limit, query.cursor); return paginated(c, page.data, page.nextCursor, page.hasMore); });
notificationsRoutes.put("/read-all", async (c) => { const session = await requireSession(c); await enforceRateLimit(c, "notifications.read", session.user.id, 300, 60 * 60); return success(c, { updated: await markAllNotificationsRead(session.user.id) }); });
notificationsRoutes.put("/:id/read", async (c) => { const session = await requireSession(c); await enforceRateLimit(c, "notifications.read", session.user.id, 300, 60 * 60); const id = notificationIdSchema.parse(c.req.param("id")); const row = await markNotificationRead(session.user.id, id); if (!row) throw new AppError(404, "NOT_FOUND", "The notification was not found."); return success(c, { id: row.id, read_at: row.readAt?.toISOString() ?? null }); });
