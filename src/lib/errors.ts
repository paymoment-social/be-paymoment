import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { ErrorCode } from "../contracts/common";

type FieldErrors = Record<string, string>;

export class AppError extends Error {
  constructor(
    public readonly status: ContentfulStatusCode,
    public readonly code: ErrorCode,
    message: string,
    public readonly fields?: FieldErrors,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function errorPayload(c: Context, error: AppError) {
  return {
    error: {
      code: error.code,
      message: error.message,
      ...(error.fields ? { fields: error.fields } : {}),
      request_id: c.get("requestId"),
    },
  };
}

export function handleError(error: Error, c: Context) {
  if (error instanceof AppError) return c.json(errorPayload(c, error), error.status);
  console.error(JSON.stringify({
    level: "error",
    message: "Unhandled API error",
    request_id: c.get("requestId"),
    error_name: error.name,
  }));
  const internal = new AppError(500, "INTERNAL_ERROR", "An unexpected error occurred.");
  return c.json(errorPayload(c, internal), 500);
}
