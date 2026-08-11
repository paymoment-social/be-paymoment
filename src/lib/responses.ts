import type { Context } from "hono";

export function success<T>(c: Context, data: T) {
  return c.json({ data, meta: { request_id: c.get("requestId") } });
}

export function paginated<T>(c: Context, data: T[], nextCursor: string | null, hasMore: boolean, extraMeta: Record<string, unknown> = {}) {
  return c.json({
    data,
    meta: {
      ...extraMeta,
      request_id: c.get("requestId"),
      next_cursor: nextCursor,
      has_more: hasMore,
    },
  });
}
