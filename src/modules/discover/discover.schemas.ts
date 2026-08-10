import { z } from "zod";
import { cursorSchema, limitSchema } from "../../contracts/common";

export const discoverQuerySchema = z.object({
  q: z.string().trim().max(120).default(""),
  type: z.enum(["all", "people", "moments", "articles", "topics"]).default("all"),
  limit: limitSchema.default(20),
  cursor: cursorSchema.optional(),
});

export const discoverSuggestionsQuerySchema = z.object({
  q: z.string().trim().min(2).max(120),
  limit: z.coerce.number().int().min(1).max(10).default(6),
});

export type DiscoverQuery = z.infer<typeof discoverQuerySchema>;
