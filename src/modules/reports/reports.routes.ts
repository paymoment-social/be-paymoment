import { Hono } from "hono";
import { enforceRateLimit } from "../../lib/rate-limit";
import { success } from "../../lib/responses";
import { parseJson, parseQuery } from "../../lib/validation";
import { requireSession } from "../auth/auth.service";
import { createReportSchema, moderationQueueSchema, reviewReportSchema } from "./reports.schemas";
import { createReport, listModerationReports, listMyReports, requireModerator, reviewModerationReport } from "./reports.repository";

export const reportsRoutes = new Hono();
reportsRoutes.post("/", async (c) => { const session = await requireSession(c); await enforceRateLimit(c, "reports.create", session.user.id, 20, 60 * 60); return c.json({ data: { report: await createReport(session.user.id, await parseJson(c, createReportSchema)) }, meta: { request_id: c.get("requestId") } }, 201); });
reportsRoutes.get("/mine", async (c) => { const session = await requireSession(c); return success(c, { reports: await listMyReports(session.user.id, 50) }); });
reportsRoutes.get("/moderation", async (c) => { const session = await requireSession(c); await requireModerator(session.user.id); const query = parseQuery(c, moderationQueueSchema); return success(c, { reports: await listModerationReports(query.status, query.limit) }); });
reportsRoutes.patch("/:id/moderation", async (c) => { const session = await requireSession(c); await requireModerator(session.user.id); await enforceRateLimit(c, "reports.moderation", session.user.id, 120, 60 * 60); return success(c, { report: await reviewModerationReport(session.user.id, c.req.param("id"), await parseJson(c, reviewReportSchema), c.get("requestId")) }); });
