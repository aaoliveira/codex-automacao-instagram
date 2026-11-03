import { BadRequestException } from "@nestjs/common";
import { createReadStream } from "node:fs";
import { open } from "node:fs/promises";
import { createHash } from "node:crypto";
import { MEDIA_ACCEPTED_MIME_TYPES } from "./media.constants";

export interface ValidatedMediaFile {
  mimeType: string;
  mediaKind: "IMAGE" | "VIDEO";
  sha256: string;
  width: number | null;
  height: number | null;
}

export async function inspectMediaFile(
  filePath: string,
  declaredMimeType: string,
): Promise<ValidatedMediaFile> {
  const header = await readHeader(filePath, 1024 * 1024);
  const mimeType = detectMimeType(header);
  if (!mimeType || !MEDIA_ACCEPTED_MIME_TYPES.has(mimeType)) {
    throw new BadRequestException("This file format is not supported");
  }
  const declared = declaredMimeType.toLowerCase();
  if (
    declared !== "application/octet-stream" &&
    declared !== mimeType
  ) {
    throw new BadRequestException("File content does not match its declared MIME type");
  }
  const dimensions = mimeType.startsWith("image/")
    ? imageDimensions(header, mimeType)
    : { width: null, height: null };

  return {
    mimeType,
    mediaKind: mimeType.startsWith("image/") ? "IMAGE" : "VIDEO",
    sha256: await sha256File(filePath),
    width: dimensions.width,
    height: dimensions.height,
  };
}

export function detectMimeType(header: Buffer): string | null {
  if (
    header.length >= 3 &&
    header[0] === 0xff &&
    header[1] === 0xd8 &&
    header[2] === 0xff
  ) {
    return "image/jpeg";
  }
  if (
    header.length >= 8 &&
    header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) {
    return "image/png";
  }
  if (
    header.length >= 12 &&
    header.toString("ascii", 0, 4) === "RIFF" &&
    header.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  if (
    header.length >= 12 &&
    header.toString("ascii", 4, 8) === "ftyp"
  ) {
    return header.toString("ascii", 8, 12) === "qt  "
      ? "video/quicktime"
      : "video/mp4";
  }
  return null;
}

async function readHeader(filePath: string, limit: number): Promise<Buffer> {
  const handle = await open(filePath, "r");
  try {
    const buffer = Buffer.alloc(limit);
    const { bytesRead } = await handle.read(buffer, 0, limit, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk as Buffer);
  }
  return hash.digest("hex");
}

function imageDimensions(
  header: Buffer,
  mimeType: string,
): { width: number | null; height: number | null } {
  if (
    mimeType === "image/png" &&
    header.length >= 24 &&
    header.toString("ascii", 12, 16) === "IHDR"
  ) {
    return {
      width: header.readUInt32BE(16),
      height: header.readUInt32BE(20),
    };
  }

  if (mimeType === "image/jpeg") {
    let offset = 2;
    while (offset + 4 < header.length) {
      if (header[offset] !== 0xff) break;
      const marker = header[offset + 1];
      offset += 2;
      if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
        continue;
      }
      if (offset + 2 > header.length) break;
      const segmentLength = header.readUInt16BE(offset);
      if (segmentLength < 2 || offset + segmentLength > header.length) break;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        return {
          height: header.readUInt16BE(offset + 3),
          width: header.readUInt16BE(offset + 5),
        };
      }
      offset += segmentLength;
    }
  }

  if (
    mimeType === "image/webp" &&
    header.length >= 30 &&
    header.toString("ascii", 12, 16) === "VP8X"
  ) {
    const width = 1 + header[24] + (header[25] << 8) + (header[26] << 16);
    const height = 1 + header[27] + (header[28] << 8) + (header[29] << 16);
    return { width, height };
  }

  return { width: null, height: null };
}
