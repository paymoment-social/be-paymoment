import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { ErrorCode } from "../contracts/common";

type FieldErrors = Record<string, string>;

function databaseErrorDetails(error: unknown) {
  const source = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const cause = source.cause && typeof source.cause === "object" ? source.cause as Record<string, unknown> : {};
  const value = (key: string) => source[key] ?? cause[key];
  return {
    message: error instanceof Error ? error.message : String(error),
    cause: cause.message ?? cause,
    code: value("code"),
    detail: value("detail"),
    hint: value("hint"),
    constraint: value("constraint"),
    column: value("column"),
    table: value("table"),
    schema: value("schema"),
  };
}

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
    database: databaseErrorDetails(error),
  }));
  const internal = new AppError(500, "INTERNAL_ERROR", "An unexpected error occurred.");
  return c.json(errorPayload(c, internal), 500);
}
