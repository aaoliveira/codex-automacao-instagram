import { MediaStorageType } from "@prisma/client";
import { Readable } from "node:stream";

export interface MediaStorageObject {
  key: string;
  sizeBytes: number;
  lastModified: Date;
}

export interface MediaReadStream {
  stream: Readable;
  contentType: string;
  sizeBytes: number;
}

export interface MediaStorageProvider {
  readonly type: MediaStorageType;
  saveFile(sourcePath: string, key: string, contentType: string): Promise<void>;
  deleteObject(key: string): Promise<void>;
  openReadStream(key: string, contentType: string): Promise<MediaReadStream>;
  createSignedReadUrl(
    key: string,
    contentType: string,
    originalFileName: string,
    expiresInSeconds: number,
  ): Promise<string>;
  listObjects(prefix: string): Promise<MediaStorageObject[]>;
}
