import { z } from "zod";

export const requestIdSchema = z.string().min(8).max(128);
export const uuidSchema = z.uuid();
export const cursorSchema = z.string().min(1).max(2048);
export const limitSchema = z.coerce.number().int().min(1).max(100).default(20);

export const errorCodeSchema = z.enum([
  "VALIDATION_ERROR",
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "USERNAME_TAKEN",
  "BUSINESS_RULE_ERROR",
  "INSUFFICIENT_BALANCE",
  "RATE_LIMITED",
  "INTERNAL_ERROR",
  "STORAGE_ERROR",
  "SERVICE_UNAVAILABLE",
]);

export type ErrorCode = z.infer<typeof errorCodeSchema>;

export const apiErrorSchema = z.object({
  error: z.object({
    code: errorCodeSchema,
    message: z.string().min(1),
    fields: z.record(z.string(), z.string()).optional(),
    request_id: requestIdSchema,
  }),
});

export const successMetaSchema = z.object({
  request_id: requestIdSchema,
});

export const paginationMetaSchema = successMetaSchema.extend({
  next_cursor: cursorSchema.nullable(),
  has_more: z.boolean(),
});

export function successSchema<T extends z.ZodType>(data: T) {
  return z.object({ data, meta: successMetaSchema });
}

export function paginatedSchema<T extends z.ZodType>(item: T) {
  return z.object({ data: z.array(item), meta: paginationMetaSchema });
}
