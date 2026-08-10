import { z } from "zod";
import { limitSchema, uuidSchema } from "../../contracts/common";

export const notificationsQuerySchema = z.object({ cursor: z.string().max(2048).optional(), limit: limitSchema, filter: z.enum(["all", "unread", "likes", "replies", "mentions", "follows", "rewards", "reposts"]).default("all") });
export const notificationIdSchema = uuidSchema;
export const notificationPreferencesSchema = z.object({ likes: z.boolean().optional(), replies: z.boolean().optional(), mentions: z.boolean().optional(), follows: z.boolean().optional(), rewards: z.boolean().optional(), reposts: z.boolean().optional(), messages: z.boolean().optional(), email_digest: z.boolean().optional() }).refine((value) => Object.keys(value).length > 0, "Provide at least one notification preference.");
