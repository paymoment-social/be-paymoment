import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { apiErrorSchema, paginatedSchema, successSchema } from "./common";

describe("API contracts", () => {
  test("accepts the success envelope", () => {
    const schema = successSchema(z.object({ ok: z.boolean() }));
    expect(schema.parse({ data: { ok: true }, meta: { request_id: "req_12345678" } })).toEqual({
      data: { ok: true },
      meta: { request_id: "req_12345678" },
    });
  });

  test("accepts cursor pagination", () => {
    const schema = paginatedSchema(z.object({ id: z.string() }));
    expect(schema.parse({
      data: [{ id: "one" }],
      meta: { request_id: "req_12345678", next_cursor: null, has_more: false },
    }).data).toHaveLength(1);
  });

  test("rejects unknown error codes", () => {
    expect(() => apiErrorSchema.parse({
      error: { code: "RANDOM", message: "No", request_id: "req_12345678" },
    })).toThrow();
  });
});
