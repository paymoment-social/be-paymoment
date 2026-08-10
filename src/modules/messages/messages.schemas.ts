import { z } from "zod";
import { limitSchema, uuidSchema } from "../../contracts/common";
export const createConversationSchema = z.object({ recipient_id: uuidSchema });
export const createMessageRequestSchema = z.object({ recipient_id: uuidSchema });
export const respondMessageRequestSchema = z.object({ decision: z.enum(["accept", "decline"]) });
export const createMessageSchema = z.object({
  body: z.string().trim().max(5000).default(""),
  client_message_id: z.string().trim().min(8).max(128),
  reply_to_message_id: uuidSchema.optional(),
  media_asset_ids: z.array(uuidSchema).max(4).default([]),
}).refine((value) => value.body.length > 0 || value.media_asset_ids.length > 0, {
  message: "A message needs text or an attachment.",
  path: ["body"],
});
export const messageListSchema = z.object({ cursor: z.string().max(2048).optional(), limit: limitSchema });
