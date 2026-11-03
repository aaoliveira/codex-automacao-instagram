import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { MediaStorageType } from "@prisma/client";
import {
  LOCAL_MEDIA_STORAGE_PROVIDER,
  S3_MEDIA_STORAGE_PROVIDER,
} from "../media.constants";
import {
  MediaReadStream,
  MediaStorageObject,
  MediaStorageProvider,
} from "./media-storage.provider";

@Injectable()
export class MediaStorageService {
  readonly activeType: MediaStorageType;
  readonly signedUrlTtlSeconds: number;
  private readonly s3Configured: boolean;

  private readonly providers: Map<MediaStorageType, MediaStorageProvider>;

  constructor(
    @Inject(LOCAL_MEDIA_STORAGE_PROVIDER)
    local: MediaStorageProvider,
    @Inject(S3_MEDIA_STORAGE_PROVIDER)
    s3: MediaStorageProvider,
    config: ConfigService,
  ) {
    this.providers = new Map([
      [MediaStorageType.LOCAL, local],
      [MediaStorageType.S3, s3],
    ]);
    this.activeType = config.get<MediaStorageType>(
      "MEDIA_STORAGE_PROVIDER",
      MediaStorageType.LOCAL,
    );
    this.signedUrlTtlSeconds = config.get<number>(
      "MEDIA_SIGNED_URL_TTL_SECONDS",
      3_600,
    );
    this.s3Configured = Boolean(config.get<string>("S3_BUCKET", "").trim());
  }

  saveFile(sourcePath: string, key: string, contentType: string): Promise<void> {
    return this.provider(this.activeType).saveFile(sourcePath, key, contentType);
  }

  deleteObject(type: MediaStorageType, key: string): Promise<void> {
    return this.provider(type).deleteObject(key);
  }

  openReadStream(
    type: MediaStorageType,
    key: string,
    contentType: string,
  ): Promise<MediaReadStream> {
    return this.provider(type).openReadStream(key, contentType);
  }

  createSignedReadUrl(
    type: MediaStorageType,
    key: string,
    contentType: string,
    originalFileName: string,
  ): Promise<string> {
    return this.provider(type).createSignedReadUrl(
      key,
      contentType,
      originalFileName,
      this.signedUrlTtlSeconds,
    );
  }

  listObjects(
    type: MediaStorageType,
    prefix: string,
  ): Promise<MediaStorageObject[]> {
    return this.provider(type).listObjects(prefix);
  }

  isConfigured(type: MediaStorageType): boolean {
    return type === MediaStorageType.LOCAL || this.s3Configured;
  }

  openLocalSignedToken(token: string): Promise<MediaReadStream> {
    const provider = this.provider(MediaStorageType.LOCAL);
    if (!("openSignedToken" in provider)) {
      throw new Error("Local signed URL support is unavailable");
    }
    return (
      provider as MediaStorageProvider & {
        openSignedToken(token: string): Promise<MediaReadStream>;
      }
    ).openSignedToken(token);
  }

  private provider(type: MediaStorageType): MediaStorageProvider {
    const provider = this.providers.get(type);
    if (!provider) throw new Error(`Media storage provider ${type} is unavailable`);
    return provider;
  }
}
