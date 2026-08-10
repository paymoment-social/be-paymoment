import { Hono } from "hono";
import { AppError } from "../../lib/errors";
import { enforceRateLimit } from "../../lib/rate-limit";
import { success } from "../../lib/responses";
import { requireSession } from "../auth/auth.service";
import { mediaMetadataSchema } from "./media.schemas";
import { deleteMedia, getMedia, uploadMedia } from "./media.service";

const mediaRoutes = new Hono();

mediaRoutes.post("/upload", async (c) => {
  const session = await requireSession(c);
  await enforceRateLimit(c, "media.upload", session.user.id, 30, 60 * 60);
  let body: FormData;
  try {
    body = await c.req.formData();
  } catch {
    throw new AppError(400, "VALIDATION_ERROR", "The request body must be valid multipart form data.");
  }
  const file = body.get("file");
  if (!(file instanceof File)) throw new AppError(422, "VALIDATION_ERROR", "A media file is required.", { file: "Choose a file to upload." });
  const metadata = mediaMetadataSchema.safeParse({ purpose: body.get("purpose"), alt_text: body.get("alt_text") || undefined });
  if (!metadata.success) throw new AppError(422, "VALIDATION_ERROR", "The media upload metadata is invalid.", { purpose: "Choose a valid media purpose." });
  return success(c, { media: await uploadMedia(session.user.id, file, metadata.data.purpose, metadata.data.alt_text) });
});

mediaRoutes.get("/:id", async (c) => {
  const session = await requireSession(c);
  return success(c, { media: await getMedia(session.user.id, c.req.param("id")) });
});

mediaRoutes.delete("/:id", async (c) => {
  const session = await requireSession(c);
  return success(c, await deleteMedia(session.user.id, c.req.param("id")));
});

export { mediaRoutes };
