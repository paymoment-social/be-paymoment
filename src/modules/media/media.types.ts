import type { MediaPurpose } from "./media.schemas";

export type ValidatedMedia = {
  file: File;
  bytes: Uint8Array;
  purpose: MediaPurpose;
  mimeType: string;
  extension: string;
  checksumSha256: string;
  altText: string | null;
};

export type PinataUpload = {
  providerId: string;
  cid: string;
  mimeType: string;
  byteSize: number;
};
