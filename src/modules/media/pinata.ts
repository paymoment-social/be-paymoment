import { assertMediaConfigured } from "../../config";
import { AppError } from "../../lib/errors";
import type { PinataUpload } from "./media.types";

type PinataUploadResponse = {
  data?: { id?: string; cid?: string; size?: number; mime_type?: string };
};

export async function uploadPublicFile(file: File, name: string, metadata: Record<string, string>): Promise<PinataUpload> {
  const { pinataJwt } = assertMediaConfigured();
  const body = new FormData();
  body.set("network", "public");
  body.set("file", file, name);
  body.set("name", name);
  body.set("keyvalues", JSON.stringify(metadata));

  let response: Response;
  try {
    response = await fetch("https://uploads.pinata.cloud/v3/files", {
      method: "POST",
      headers: { Authorization: `Bearer ${pinataJwt}` },
      body,
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    throw new AppError(503, "STORAGE_ERROR", "The media storage provider is temporarily unavailable.");
  }
  if (!response.ok) throw new AppError(502, "STORAGE_ERROR", "The media upload could not be completed.");
  const data = (await response.json() as PinataUploadResponse).data;
  if (!data?.id || !data.cid || typeof data.size !== "number" || !data.mime_type) {
    throw new AppError(502, "STORAGE_ERROR", "The media storage provider returned an invalid response.");
  }
  return { providerId: data.id, cid: data.cid, byteSize: data.size, mimeType: data.mime_type };
}

export async function deletePublicFile(providerId: string) {
  const { pinataJwt } = assertMediaConfigured();
  try {
    const response = await fetch(`https://api.pinata.cloud/v3/files/public/${encodeURIComponent(providerId)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${pinataJwt}` },
      signal: AbortSignal.timeout(30_000),
    });
    return response.ok || response.status === 404;
  } catch {
    return false;
  }
}
