import { describe, expect, test } from "bun:test";
import { createReplySchema } from "./posts.schemas";

describe("reply contract", () => {
  test("accepts image-only replies", () => {
    const parsed = createReplySchema.parse({
      body: "",
      media_asset_ids: ["00000000-0000-4000-8000-000000000001"],
    });
    expect(parsed.body).toBe("");
  });

  test("rejects an empty reply", () => {
    expect(() => createReplySchema.parse({ body: "", media_asset_ids: [] })).toThrow();
  });
});
