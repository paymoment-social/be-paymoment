import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "../../db/client";
import { mediaAssets } from "../../db/schema";
import type { ValidatedMedia } from "./media.types";

export async function createUploadingAsset(ownerId: string, media: ValidatedMedia) {
  const [asset] = await getDb().insert(mediaAssets).values({
    ownerId,
    mimeType: media.mimeType,
    extension: media.extension,
    byteSize: media.bytes.byteLength,
    checksumSha256: media.checksumSha256,
    altText: media.altText,
    purpose: media.purpose,
    status: "uploading",
    expiresAt: new Date(Date.now() + 60 * 60 * 1_000),
  }).returning();
  if (!asset) throw new Error("Unable to create the media asset.");
  return asset;
}

export async function markAssetReady(id: string, provider: { providerId: string; cid: string; gatewayUrl: string; name?: string }) {
  const [asset] = await getDb().update(mediaAssets).set({
    provider: provider.name ?? "r2",
    providerId: provider.providerId,
    cid: provider.cid,
    gatewayUrl: provider.gatewayUrl,
    status: "ready",
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1_000),
    updatedAt: new Date(),
  }).where(eq(mediaAssets.id, id)).returning();
  if (!asset) throw new Error("Unable to finalize the media asset.");
  return asset;
}

export async function markAssetFailed(id: string, providerId?: string) {
  await getDb().update(mediaAssets).set({
    ...(providerId ? { providerId } : {}),
    status: "failed",
    expiresAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(mediaAssets.id, id));
}

export async function findOwnedAsset(id: string, ownerId: string) {
  const [asset] = await getDb().select().from(mediaAssets).where(and(
    eq(mediaAssets.id, id), eq(mediaAssets.ownerId, ownerId), isNull(mediaAssets.deletedAt),
  )).limit(1);
  return asset ?? null;
}

export async function softDeleteUnattachedAsset(id: string, ownerId: string) {
  const [asset] = await getDb().update(mediaAssets).set({ status: "deleted", deletedAt: new Date(), updatedAt: new Date() }).where(and(
    eq(mediaAssets.id, id), eq(mediaAssets.ownerId, ownerId), isNull(mediaAssets.attachedAt), isNull(mediaAssets.deletedAt),
  )).returning();
  return asset ?? null;
}
