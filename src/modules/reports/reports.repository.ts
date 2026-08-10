import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { getDb } from "../../db/client";
import { auditLogs, messages, postReplies, posts, reports, userRoles, users } from "../../db/schema";
import { AppError } from "../../lib/errors";

export async function createReport(reporterId: string, input: { target_type: "user" | "post" | "reply" | "message"; target_id: string; reason: string; details?: string }) {
  if (input.target_type === "user" && input.target_id === reporterId) throw new AppError(422, "BUSINESS_RULE_ERROR", "You cannot report your own account.");
  const exists = input.target_type === "user" ? await getDb().select({ id: users.id }).from(users).where(and(eq(users.id, input.target_id), eq(users.status, "active"), isNull(users.deletedAt))).limit(1) : input.target_type === "post" ? await getDb().select({ id: posts.id }).from(posts).where(and(eq(posts.id, input.target_id), isNull(posts.deletedAt))).limit(1) : input.target_type === "reply" ? await getDb().select({ id: postReplies.id }).from(postReplies).where(and(eq(postReplies.id, input.target_id), isNull(postReplies.deletedAt))).limit(1) : await getDb().select({ id: messages.id }).from(messages).where(and(eq(messages.id, input.target_id), isNull(messages.deletedAt))).limit(1);
  if (!exists.length) throw new AppError(404, "NOT_FOUND", "The report target was not found.");
  const [report] = await getDb().insert(reports).values({ reporterId, targetType: input.target_type, targetId: input.target_id, reason: input.reason, details: input.details || null }).onConflictDoNothing().returning();
  if (!report) throw new AppError(409, "CONFLICT", "You already have an open report for this item.");
  return { id: report.id, status: report.status, created_at: report.createdAt.toISOString() };
}

export async function listMyReports(reporterId: string, limit: number) {
  const rows = await getDb().select().from(reports).where(eq(reports.reporterId, reporterId)).orderBy(desc(reports.createdAt), desc(reports.id)).limit(limit);
  return rows.map((report) => ({ id: report.id, target_type: report.targetType, reason: report.reason, status: report.status, created_at: report.createdAt.toISOString(), resolved_at: report.resolvedAt?.toISOString() ?? null }));
}

export async function requireModerator(userId: string) {
  const rows = await getDb().select({ role: userRoles.role }).from(userRoles).where(and(eq(userRoles.userId, userId), inArray(userRoles.role, ["moderator", "admin"]))).limit(1);
  if (!rows.length) throw new AppError(403, "FORBIDDEN", "Moderator access is required.");
}

export async function listModerationReports(status: "open" | "reviewing" | "resolved" | "dismissed", limit: number) {
  const rows = await getDb().select().from(reports).where(eq(reports.status, status)).orderBy(desc(reports.createdAt), desc(reports.id)).limit(limit);
  return rows.map((report) => ({ id: report.id, reporter_id: report.reporterId, target_type: report.targetType, target_id: report.targetId, reason: report.reason, details: report.details, status: report.status, reviewed_by_id: report.reviewedById, resolution: report.resolution, created_at: report.createdAt.toISOString(), updated_at: report.updatedAt.toISOString(), resolved_at: report.resolvedAt?.toISOString() ?? null }));
}

export async function reviewModerationReport(moderatorId: string, reportId: string, input: { action: "reviewing" | "resolved" | "dismissed"; resolution?: string; moderate_target: boolean }, requestId?: string) {
  return getDb().transaction(async (tx) => {
    const [current] = await tx.select().from(reports).where(eq(reports.id, reportId)).limit(1);
    if (!current) throw new AppError(404, "NOT_FOUND", "The report was not found.");
    if (["resolved", "dismissed"].includes(current.status)) throw new AppError(409, "CONFLICT", "This report has already been finalized.");
    if (input.moderate_target && input.action !== "resolved") throw new AppError(422, "VALIDATION_ERROR", "A target can only be moderated when resolving a report.", { action: "Choose resolved before moderating a target." });
    if (input.moderate_target) {
      if (current.targetType === "post") await tx.update(posts).set({ status: "moderated", updatedAt: new Date() }).where(eq(posts.id, current.targetId));
      if (current.targetType === "reply") await tx.update(postReplies).set({ status: "moderated", updatedAt: new Date() }).where(eq(postReplies.id, current.targetId));
      if (current.targetType === "message") await tx.update(messages).set({ status: "deleted", deletedAt: new Date(), updatedAt: new Date() }).where(eq(messages.id, current.targetId));
      if (current.targetType === "user") await tx.update(users).set({ status: "suspended", updatedAt: new Date() }).where(eq(users.id, current.targetId));
    }
    const finalized = input.action === "resolved" || input.action === "dismissed";
    const [updated] = await tx.update(reports).set({ status: input.action, reviewedById: moderatorId, resolution: input.resolution ?? null, resolvedAt: finalized ? new Date() : null, updatedAt: new Date() }).where(eq(reports.id, reportId)).returning();
    await tx.insert(auditLogs).values({ actorUserId: moderatorId, actorType: "admin", action: `report.${input.action}`, entityType: "report", entityId: reportId, requestId, metadata: { target_type: current.targetType, target_id: current.targetId, moderate_target: input.moderate_target } });
    return { id: updated!.id, status: updated!.status, resolution: updated!.resolution, moderated: input.moderate_target, resolved_at: updated!.resolvedAt?.toISOString() ?? null };
  });
}
