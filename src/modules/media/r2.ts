import { DeleteObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { assertMediaConfigured } from "../../config";
import { AppError } from "../../lib/errors";
import type { PinataUpload } from "./media.types";

function client() {
  const value = assertMediaConfigured();
  const endpoint = value.r2Endpoint.replace(new RegExp(`/${value.r2Bucket}/?$`), "").replace(/\/$/, "");
  return { value, s3: new S3Client({
    endpoint,
    region: value.r2Region || "auto",
    forcePathStyle: true,
    credentials: { accessKeyId: value.r2AccessKeyId, secretAccessKey: value.r2SecretAccessKey },
  }) };
}

export async function uploadPublicFile(file: File, name: string, metadata: Record<string, string>): Promise<PinataUpload> {
  const { value, s3 } = client();
  try {
    await s3.send(new PutObjectCommand({
      Bucket: value.r2Bucket,
      Key: name,
      Body: new Uint8Array(await file.arrayBuffer()),
      ContentType: file.type,
      Metadata: metadata,
      CacheControl: "public, max-age=31536000, immutable",
    }));
  } catch (error) {
    console.error(JSON.stringify({ level: "error", message: "R2 media upload failed", error: error instanceof Error ? { name: error.name, message: error.message, cause: error.cause } : String(error) }));
    throw new AppError(502, "STORAGE_ERROR", "The R2 media upload could not be completed.");
  }
  return { providerId: name, cid: name, byteSize: file.size, mimeType: file.type };
}

export async function deletePublicFile(providerId: string) {
  const { value, s3 } = client();
  try {
    await s3.send(new DeleteObjectCommand({ Bucket: value.r2Bucket, Key: providerId }));
    return true;
  } catch {
    return false;
  }
}

export function publicGatewayUrl(key: string) {
  const { value } = client();
  return `${value.r2PublicUrl.replace(/\/$/, "")}/${key.split("/").map(encodeURIComponent).join("/")}`;
}
