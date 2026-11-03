import { ConfigService } from "@nestjs/config";
import { Injectable, OnModuleDestroy } from "@nestjs/common";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { MediaStorageType } from "@prisma/client";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import {
  MediaReadStream,
  MediaStorageObject,
  MediaStorageProvider,
} from "./media-storage.provider";

@Injectable()
export class S3StorageProvider implements MediaStorageProvider, OnModuleDestroy {
  readonly type = MediaStorageType.S3;
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: ConfigService) {
    this.bucket = config.get<string>("S3_BUCKET", "");
    this.client = new S3Client({
      region: config.get<string>("S3_REGION", "us-east-1"),
      ...(config.get<string>("S3_ENDPOINT")
        ? { endpoint: config.get<string>("S3_ENDPOINT") }
        : {}),
      forcePathStyle: config.get<boolean>("S3_FORCE_PATH_STYLE", false),
    });
  }

  async saveFile(
    sourcePath: string,
    key: string,
    contentType: string,
  ): Promise<void> {
    const upload = new Upload({
      client: this.client,
      params: {
        Bucket: this.bucketName(),
        Key: key,
        Body: createReadStream(sourcePath),
        ContentType: contentType,
        ServerSideEncryption: "AES256",
      },
      queueSize: 2,
      partSize: 8 * 1024 * 1024,
      leavePartsOnError: false,
    });
    await upload.done();
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucketName(), Key: key }),
    );
  }

  async openReadStream(
    key: string,
    contentType: string,
  ): Promise<MediaReadStream> {
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucketName(), Key: key }),
    );
    const body = response.Body;
    if (!body || typeof (body as Readable).pipe !== "function") {
      throw new Error("S3 returned an unreadable media object");
    }
    return {
      stream: body as Readable,
      contentType: response.ContentType ?? contentType,
      sizeBytes: response.ContentLength ?? 0,
    };
  }

  createSignedReadUrl(
    key: string,
    contentType: string,
    originalFileName: string,
    expiresInSeconds: number,
  ): Promise<string> {
    const safeName = originalFileName.replace(/[\r\n"\\]/g, "_");
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucketName(),
        Key: key,
        ResponseContentType: contentType,
        ResponseContentDisposition: `inline; filename="${safeName}"`,
      }),
      { expiresIn: expiresInSeconds },
    );
  }

  async listObjects(prefix: string): Promise<MediaStorageObject[]> {
    const result: MediaStorageObject[] = [];
    let continuationToken: string | undefined;
    do {
      const page = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucketName(),
          Prefix: prefix ? `${prefix.replace(/\/+$/, "")}/` : undefined,
          ContinuationToken: continuationToken,
        }),
      );
      for (const object of page.Contents ?? []) {
        if (!object.Key || object.Size === undefined || !object.LastModified) continue;
        result.push({
          key: object.Key,
          sizeBytes: object.Size,
          lastModified: object.LastModified,
        });
      }
      continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (continuationToken);
    return result;
  }

  destroy(): void {
    this.client.destroy();
  }

  onModuleDestroy(): void {
    this.destroy();
  }

  private bucketName(): string {
    if (!this.bucket) throw new Error("S3_BUCKET is required for S3 media storage");
    return this.bucket;
  }
}
