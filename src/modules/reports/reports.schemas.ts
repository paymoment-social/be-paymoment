import { z } from "zod";
import { uuidSchema } from "../../contracts/common";

export const createReportSchema = z.object({ target_type: z.enum(["user", "post", "reply", "message"]), target_id: uuidSchema, reason: z.enum(["spam", "harassment", "hate", "violence", "sexual_content", "impersonation", "self_harm", "other"]), details: z.string().trim().max(2_000).optional() });
export const moderationQueueSchema = z.object({ status: z.enum(["open", "reviewing", "resolved", "dismissed"]).default("open"), limit: z.coerce.number().int().min(1).max(100).default(50) });
export const reviewReportSchema = z.object({ action: z.enum(["reviewing", "resolved", "dismissed"]), resolution: z.string().trim().max(2_000).optional(), moderate_target: z.boolean().default(false) }).superRefine((value, context) => { if (value.action === "resolved" && !value.resolution) context.addIssue({ code: "custom", path: ["resolution"], message: "Provide a resolution when resolving a report." }); });
