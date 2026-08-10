import { describe, expect, test } from "bun:test";
import { AppError } from "../../lib/errors";
import { validateMediaFile } from "./media.service";

const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

describe("media validation", () => {
  test("accepts a correctly declared image and computes a checksum", async () => {
    const result = await validateMediaFile(new File([pngBytes], "avatar.png", { type: "image/png" }), "avatar", " Avatar ");
    expect(result.extension).toBe("png");
    expect(result.altText).toBe("Avatar");
    expect(result.checksumSha256).toHaveLength(64);
  });

  test("rejects MIME spoofing", async () => {
    const promise = validateMediaFile(new File(["not a png"], "fake.png", { type: "image/png" }), "post");
    await expect(promise).rejects.toBeInstanceOf(AppError);
    await expect(promise).rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 422 });
  });

  test("rejects file types outside the purpose allowlist", async () => {
    await expect(validateMediaFile(new File(["text"], "notes.txt", { type: "text/plain" }), "message")).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});
