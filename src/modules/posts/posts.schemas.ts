import { z } from "zod";
import { limitSchema, uuidSchema } from "../../contracts/common";

const visibilitySchema = z.enum(["public", "followers", "private"]);
const mediaIdsSchema = z.array(uuidSchema).max(4).default([]).transform((ids) => [...new Set(ids)]);

export const createPostSchema = z.object({
  kind: z.enum(["moment", "quote", "poll"]).default("moment"),
  body: z.string().trim().max(500).default(""),
  visibility: visibilitySchema.default("public"),
  quoted_post_id: uuidSchema.optional(),
  media_asset_ids: mediaIdsSchema,
  poll: z.object({
    question: z.string().trim().min(1).max(160),
    options: z.array(z.string().trim().min(1).max(80)).min(2).max(4).refine((values) => new Set(values.map((value) => value.toLowerCase())).size === values.length, "Poll options must be unique."),
    voter_visibility: z.enum(["public", "anonymous"]).default("public"),
    allow_vote_change: z.boolean().default(true),
    ends_at: z.iso.datetime().optional(),
  }).optional(),
}).superRefine((value, context) => {
  if (!value.body && !value.media_asset_ids.length && value.kind !== "poll") context.addIssue({ code: "custom", path: ["body"], message: "Add text or media to the Moment." });
  if (value.kind === "quote" && !value.quoted_post_id) context.addIssue({ code: "custom", path: ["quoted_post_id"], message: "Choose a Moment to quote." });
  if (value.kind !== "quote" && value.quoted_post_id) context.addIssue({ code: "custom", path: ["quoted_post_id"], message: "Only quote Moments can reference another Moment." });
  if (value.kind === "poll" && !value.poll) context.addIssue({ code: "custom", path: ["poll"], message: "Poll details are required." });
  if (value.kind !== "poll" && value.poll) context.addIssue({ code: "custom", path: ["poll"], message: "Poll details are only allowed for poll Moments." });
});

export const updatePostSchema = z.object({
  body: z.string().trim().max(500).optional(),
  visibility: visibilitySchema.optional(),
}).refine((value) => Object.keys(value).length > 0, "Provide at least one field to update.");

const articleFieldsSchema = z.object({
  title: z.string().trim().min(1).max(120),
  eyebrow: z.string().trim().max(80).optional(),
  description: z.string().trim().min(1).max(300),
  content_html: z.string().min(1).max(200_000),
  banner_media_id: uuidSchema.optional(),
  banner_color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a six-digit hexadecimal color.").default("#17181B"),
  banner_position: z.enum(["left", "center", "right"]).default("center"),
  visibility: visibilitySchema.default("public"),
  scheduled_at: z.iso.datetime().nullable().optional(),
  publish: z.boolean().default(false),
});
export const createArticleSchema = articleFieldsSchema.refine((value) => !value.publish || !value.scheduled_at, { path: ["scheduled_at"], message: "A published article cannot also be scheduled." });

export const updateArticleSchema = articleFieldsSchema.omit({ publish: true }).partial().extend({ draft_version: z.number().int().positive() })
  .refine((value) => Object.keys(value).some((key) => key !== "draft_version"), "Provide at least one field to update.");

export const createReplySchema = z.object({
  body: z.string().trim().max(500).default(""),
  parent_id: uuidSchema.optional(),
  media_asset_ids: z.array(uuidSchema).max(1).default([]).transform((ids) => [...new Set(ids)]),
}).refine((value) => Boolean(value.body || value.media_asset_ids.length), { path: ["body"], message: "Add text or an image to the reply." });

export const updateReplySchema = z.object({ body: z.string().trim().min(1).max(500) });
export const votePollSchema = z.object({ option_id: uuidSchema });
export const shareSchema = z.object({ channel: z.enum(["copy", "native", "email", "other"]) });

export const listContentQuerySchema = z.object({
  cursor: z.string().max(2048).optional(),
  limit: limitSchema,
  parent_id: uuidSchema.optional(),
});

export const feedUpdatesQuerySchema = z.object({
  since: z.iso.datetime(),
});

export const listBookmarksQuerySchema = listContentQuerySchema.omit({ parent_id: true }).extend({
  filter: z.enum(["all", "media", "text"]).default("all"),
});

export type CreatePostInput = z.infer<typeof createPostSchema>;
export type UpdatePostInput = z.infer<typeof updatePostSchema>;
export type CreateArticleInput = z.infer<typeof createArticleSchema>;
export type UpdateArticleInput = z.infer<typeof updateArticleSchema>;
export type CreateReplyInput = z.infer<typeof createReplySchema>;
