import { MediaStorageType } from "@prisma/client";

export const LOCAL_MEDIA_STORAGE_PROVIDER = Symbol("LOCAL_MEDIA_STORAGE_PROVIDER");
export const S3_MEDIA_STORAGE_PROVIDER = Symbol("S3_MEDIA_STORAGE_PROVIDER");

export const DEFAULT_MEDIA_MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024;
const configuredMaxSize = Number(process.env.MEDIA_MAX_FILE_SIZE_BYTES);
export const MEDIA_MAX_FILE_SIZE_BYTES =
  Number.isSafeInteger(configuredMaxSize) && configuredMaxSize > 0
    ? configuredMaxSize
    : DEFAULT_MEDIA_MAX_FILE_SIZE_BYTES;

export const MEDIA_ACCEPTED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "video/mp4",
  "video/quicktime",
]);

export function mediaExtension(mimeType: string): string {
  switch (mimeType) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "video/mp4":
      return "mp4";
    case "video/quicktime":
      return "mov";
    default:
      throw new Error("Unsupported media type");
  }
}

export function mediaStorageTypeFromEnvironment(): MediaStorageType {
  return process.env.MEDIA_STORAGE_PROVIDER === "S3"
    ? MediaStorageType.S3
    : MediaStorageType.LOCAL;
}
