import { ConfigService } from "@nestjs/config";
import { Injectable } from "@nestjs/common";
import { MediaStorageType } from "@prisma/client";
import {
  chmod,
  copyFile,
  mkdir,
  readdir,
  stat,
  unlink,
} from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHmac, timingSafeEqual } from "node:crypto";
import path from "node:path";
import { NotFoundException } from "@nestjs/common";
import {
  MediaReadStream,
  MediaStorageObject,
  MediaStorageProvider,
} from "./media-storage.provider";

type SignedLocalMedia = {
  key: string;
  contentType: string;
  expiresAt: number;
};

@Injectable()
export class LocalStorageProvider implements MediaStorageProvider {
  readonly type = MediaStorageType.LOCAL;
  private readonly root: string;
  private readonly signingSecret: string;
  private readonly publicApiUrl: string;

  constructor(config: ConfigService) {
    this.root = path.resolve(config.get("MEDIA_LOCAL_ROOT", "./var/media"));
    this.signingSecret = config.getOrThrow<string>("MEDIA_URL_SIGNING_SECRET");
    this.publicApiUrl = config.get<string>(
      "MEDIA_PUBLIC_API_URL",
      "http://localhost:3001",
    );
  }

  async saveFile(
    sourcePath: string,
    key: string,
    _contentType: string,
  ): Promise<void> {
    const target = this.resolveKey(key);
    const directory = path.dirname(target);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700);
    await copyFile(sourcePath, target);
    await chmod(target, 0o600);
  }

  async deleteObject(key: string): Promise<void> {
    const target = this.resolveKey(key);
    await unlink(target).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }

  async openReadStream(
    key: string,
    contentType: string,
  ): Promise<MediaReadStream> {
    const target = this.resolveKey(key);
    const info = await stat(target).catch(() => {
      throw new NotFoundException("Media asset file not found");
    });
    if (!info.isFile()) throw new NotFoundException("Media asset file not found");
    return {
      stream: createReadStream(target),
      contentType,
      sizeBytes: info.size,
    };
  }

  async createSignedReadUrl(
    key: string,
    contentType: string,
    _originalFileName: string,
    expiresInSeconds: number,
  ): Promise<string> {
    const payload: SignedLocalMedia = {
      key,
      contentType,
      expiresAt: Math.floor(Date.now() / 1_000) + expiresInSeconds,
    };
    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const signature = this.sign(encodedPayload);
    const url = new URL("/api/media/local", this.publicApiUrl);
    url.searchParams.set("token", `${encodedPayload}.${signature}`);
    return url.toString();
  }

  async openSignedToken(token: string): Promise<MediaReadStream> {
    const separator = token.lastIndexOf(".");
    if (separator <= 0 || separator === token.length - 1) {
      throw new NotFoundException("Signed media URL is invalid or expired");
    }
    const encodedPayload = token.slice(0, separator);
    const presentedSignature = token.slice(separator + 1);
    const expectedSignature = this.sign(encodedPayload);
    const expectedBytes = Buffer.from(expectedSignature);
    const presentedBytes = Buffer.from(presentedSignature);
    if (
      expectedBytes.length !== presentedBytes.length ||
      !timingSafeEqual(expectedBytes, presentedBytes)
    ) {
      throw new NotFoundException("Signed media URL is invalid or expired");
    }

    let payload: SignedLocalMedia;
    try {
      payload = JSON.parse(
        Buffer.from(encodedPayload, "base64url").toString("utf8"),
      ) as SignedLocalMedia;
    } catch {
      throw new NotFoundException("Signed media URL is invalid or expired");
    }
    if (
      !payload.key ||
      !payload.contentType ||
      !Number.isInteger(payload.expiresAt) ||
      payload.expiresAt <= Math.floor(Date.now() / 1_000)
    ) {
      throw new NotFoundException("Signed media URL is invalid or expired");
    }
    return this.openReadStream(payload.key, payload.contentType);
  }

  async listObjects(prefix: string): Promise<MediaStorageObject[]> {
    const normalizedPrefix = prefix.replace(/\/+$/, "");
    const root = normalizedPrefix ? this.resolveKey(normalizedPrefix) : this.root;
    const result: MediaStorageObject[] = [];
    await this.walk(root, normalizedPrefix, result);
    return result;
  }

  private async walk(
    directory: string,
    keyPrefix: string,
    result: MediaStorageObject[],
  ): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true }).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return [];
        throw error;
      },
    );
    for (const entry of entries) {
      const filePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await this.walk(filePath, keyPrefix, result);
      } else if (entry.isFile()) {
        const info = await stat(filePath);
        const relative = path.relative(this.root, filePath).split(path.sep).join("/");
        if (relative.startsWith(`${keyPrefix}/`) || relative === keyPrefix) {
          result.push({
            key: relative,
            sizeBytes: info.size,
            lastModified: info.mtime,
          });
        }
      }
    }
  }

  private resolveKey(key: string): string {
    const normalized = key.replace(/\\/g, "/");
    if (
      !normalized ||
      normalized.startsWith("/") ||
      normalized.split("/").some((part) => !part || part === "." || part === "..")
    ) {
      throw new NotFoundException("Media object not found");
    }
    const target = path.resolve(this.root, normalized);
    if (!target.startsWith(`${this.root}${path.sep}`)) {
      throw new NotFoundException("Media object not found");
    }
    return target;
  }

  private sign(value: string): string {
    return createHmac("sha256", this.signingSecret)
      .update(value)
      .digest("base64url");
  }
}
