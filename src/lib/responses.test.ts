import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { paginated } from "./responses";

describe("response helpers", () => {
  test("adds a server feed snapshot without replacing pagination metadata", async () => {
    const app = new Hono();
    app.use("*", async (c, next) => {
      c.set("requestId", "response-test");
      await next();
    });
    app.get("/", (c) => paginated(c, [{ id: "post-1" }], null, false, { snapshot_at: "2026-08-11T00:00:00.000Z" }));

    const response = await app.request("/");
    const body = await response.json();
    expect(body.meta).toEqual({
      snapshot_at: "2026-08-11T00:00:00.000Z",
      request_id: "response-test",
      next_cursor: null,
      has_more: false,
    });
  });
});
