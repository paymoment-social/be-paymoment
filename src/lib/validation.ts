import type { Context } from "hono";
import type { z } from "zod";
import { AppError } from "./errors";

export async function parseJson<T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T>> {
  let input: unknown;
  try {
    input = await c.req.json();
  } catch {
    throw new AppError(400, "VALIDATION_ERROR", "The request body must be valid JSON.");
  }
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const fields: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join(".") || "body";
    fields[key] ??= issue.message;
  }
  throw new AppError(422, "VALIDATION_ERROR", "One or more fields are invalid.", fields);
}

export function parseQuery<T extends z.ZodType>(c: Context, schema: T): z.infer<T> {
  const result = schema.safeParse(c.req.query());
  if (result.success) return result.data;
  const fields: Record<string, string> = {};
  for (const issue of result.error.issues) fields[issue.path.join(".") || "query"] ??= issue.message;
  throw new AppError(422, "VALIDATION_ERROR", "One or more query parameters are invalid.", fields);
}
