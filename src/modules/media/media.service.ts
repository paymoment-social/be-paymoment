import { createHash } from "node:crypto";
import { z } from "zod";
import { config } from "../../config";
import { AppError } from "../../lib/errors";
import type { MediaPurpose } from "./media.schemas";
import { createUploadingAsset, findOwnedAsset, markAssetFailed, markAssetReady, softDeleteUnattachedAsset } from "./media.repository";
import { deletePublicFile, uploadPublicFile } from "./pinata";
import type { ValidatedMedia } from "./media.types";

const MIME_RULES: Record<MediaPurpose, { maxBytes: number; allowed: string[] }> = {
  avatar: { maxBytes: 5 * 1024 * 1024, allowed: ["image/jpeg", "image/png", "image/webp"] },
  post: { maxBytes: 10 * 1024 * 1024, allowed: ["image/jpeg", "image/png", "image/webp", "image/gif"] },
  reply: { maxBytes: 5 * 1024 * 1024, allowed: ["image/jpeg", "image/png", "image/webp", "image/gif"] },
  article: { maxBytes: 10 * 1024 * 1024, allowed: ["image/jpeg", "image/png", "image/webp", "image/gif"] },
  message: { maxBytes: 25 * 1024 * 1024, allowed: ["image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf"] },
};

const EXTENSIONS: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "application/pdf": "pdf" };
const decode = (bytes: Uint8Array, start: number, end: number) => new TextDecoder().decode(bytes.slice(start, end));

function hasSignature(bytes: Uint8Array, mimeType: string) {
  if (mimeType === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mimeType === "image/png") return [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, index) => bytes[index] === value);
  if (mimeType === "image/gif") return decode(bytes, 0, 6) === "GIF87a" || decode(bytes, 0, 6) === "GIF89a";
  if (mimeType === "image/webp") return decode(bytes, 0, 4) === "RIFF" && decode(bytes, 8, 12) === "WEBP";
  if (mimeType === "application/pdf") return decode(bytes, 0, 5) === "%PDF-";
  return false;
}

export async function validateMediaFile(file: File, purpose: MediaPurpose, altText?: string): Promise<ValidatedMedia> {
  const rule = MIME_RULES[purpose];
  if (!rule.allowed.includes(file.type)) throw new AppError(422, "VALIDATION_ERROR", "This file type is not supported for the selected media purpose.", { file: "Choose a supported file type." });
  if (file.size <= 0 || file.size > rule.maxBytes) throw new AppError(422, "VALIDATION_ERROR", "The uploaded file size is invalid.", { file: `The file must be no larger than ${Math.floor(rule.maxBytes / 1024 / 1024)} MB.` });
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength !== file.size || !hasSignature(bytes, file.type)) throw new AppError(422, "VALIDATION_ERROR", "The file content does not match its declared type.", { file: "Choose a valid, unmodified file." });
  return { file, bytes, purpose, mimeType: file.type, extension: EXTENSIONS[file.type]!, checksumSha256: createHash("sha256").update(bytes).digest("hex"), altText: altText?.trim() || null };
}

const publicGatewayUrl = (cid: string) => `${config().pinataGatewayUrl.replace(/\/$/, "")}/ipfs/${cid}`;

export async function uploadMedia(ownerId: string, file: File, purpose: MediaPurpose, altText?: string) {
  const validated = await validateMediaFile(file, purpose, altText);
  const asset = await createUploadingAsset(ownerId, validated);
  let providerId: string | undefined;
  try {
    const uploaded = await uploadPublicFile(file, `${asset.id}.${validated.extension}`, { owner_id: ownerId, asset_id: asset.id, purpose });
    providerId = uploaded.providerId;
    if (uploaded.byteSize !== validated.bytes.byteLength || uploaded.mimeType !== validated.mimeType) throw new AppError(502, "STORAGE_ERROR", "The uploaded media could not be verified.");
    return await markAssetReady(asset.id, { providerId, cid: uploaded.cid, gatewayUrl: publicGatewayUrl(uploaded.cid) });
  } catch (error) {
    await markAssetFailed(asset.id, providerId);
    if (providerId) await deletePublicFile(providerId);
    if (error instanceof AppError) throw error;
    throw new AppError(502, "STORAGE_ERROR", "The media upload could not be completed.");
  }
}

export async function getMedia(ownerId: string, idValue: string) {
  const id = z.uuid().safeParse(idValue);
  if (!id.success) throw new AppError(404, "NOT_FOUND", "The media asset was not found.");
  const asset = await findOwnedAsset(id.data, ownerId);
  if (!asset) throw new AppError(404, "NOT_FOUND", "The media asset was not found.");
  return asset;
}

export async function deleteMedia(ownerId: string, idValue: string) {
  const asset = await getMedia(ownerId, idValue);
  if (asset.attachedAt) throw new AppError(409, "CONFLICT", "Attached media cannot be deleted directly.");
  const deleted = await softDeleteUnattachedAsset(asset.id, ownerId);
  if (!deleted) throw new AppError(409, "CONFLICT", "The media asset is already attached or deleted.");
  const providerDeleted = deleted.providerId ? await deletePublicFile(deleted.providerId) : true;
  return { id: deleted.id, deleted: true as const, provider_cleanup_pending: !providerDeleted };
}
