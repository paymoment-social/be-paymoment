import { z } from "zod";

export const mediaPurposeSchema = z.enum(["avatar", "post", "reply", "article", "message"]);

export const mediaMetadataSchema = z.object({
  purpose: mediaPurposeSchema,
  alt_text: z.string().trim().max(500).optional(),
});

export type MediaPurpose = z.infer<typeof mediaPurposeSchema>;
