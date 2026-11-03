import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  MediaAsset,
  MediaStorageType,
  Prisma,
  PublicationStatus,
} from "@prisma/client";
import { randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import path from "node:path";
import { PrismaService } from "../prisma/prisma.service";
import { MediaAssetsQueryDto, MediaUploadOptionsDto } from "./dto/media-assets-query.dto";
import { MEDIA_MAX_FILE_SIZE_BYTES, mediaExtension } from "./media.constants";
import { inspectMediaFile } from "./media-file-metadata";
import { MediaStorageService } from "./storage/media-storage.service";

export interface UploadedMediaFile {
  path: string;
  size: number;
  mimetype: string;
  originalname: string;
}

@Injectable()
export class MediaAssetsService {
  private readonly maxFileSizeBytes: number;
  private readonly orphanGraceHours: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: MediaStorageService,
    config: ConfigService,
  ) {
    this.maxFileSizeBytes = config.get<number>(
      "MEDIA_MAX_FILE_SIZE_BYTES",
      MEDIA_MAX_FILE_SIZE_BYTES,
    );
    this.orphanGraceHours = config.get<number>(
      "MEDIA_ORPHAN_GRACE_HOURS",
      24,
    );
  }

  async upload(
    organizationId: string,
    file: UploadedMediaFile,
    options: MediaUploadOptionsDto,
  ) {
    if (!file?.path) throw new BadRequestException("A media file is required");
    try {
      if (file.size <= 0) throw new BadRequestException("The uploaded file is empty");
      if (file.size > this.maxFileSizeBytes) {
        throw new BadRequestException("The uploaded file exceeds the size limit");
      }

      const inspected = await inspectMediaFile(file.path, file.mimetype);
      const originalFileName = safeOriginalFileName(file.originalname);
      if (options.deduplicate) {
        const existing = await this.prisma.mediaAsset.findFirst({
          where: { organizationId, sha256: inspected.sha256 },
        });
        if (existing) return this.toPublic(existing);
      }

      const id = randomUUID();
      const storageType = this.storage.activeType;
      const storageKey = `${organizationId}/${id}.${mediaExtension(inspected.mimeType)}`;
      await this.storage.saveFile(file.path, storageKey, inspected.mimeType);

      try {
        const metadata: Prisma.InputJsonObject = {
          mediaKind: inspected.mediaKind,
          sha256Algorithm: "SHA-256",
          detectedMimeType: inspected.mimeType,
          ...(inspected.width ? { width: inspected.width } : {}),
          ...(inspected.height ? { height: inspected.height } : {}),
        };
        const asset = await this.prisma.mediaAsset.create({
          data: {
            id,
            organizationId,
            storageType,
            storageKey,
            originalFileName,
            mimeType: inspected.mimeType,
            mediaKind: inspected.mediaKind,
            sizeBytes: file.size,
            sha256: inspected.sha256,
            width: inspected.width,
            height: inspected.height,
            metadata,
          },
        });
        return this.toPublic(asset);
      } catch (error) {
        await this.storage.deleteObject(storageType, storageKey).catch(() => undefined);
        throw error;
      }
    } finally {
      await unlink(file.path).catch(() => undefined);
    }
  }

  async list(organizationId: string, query: MediaAssetsQueryDto) {
    const search = query.search?.trim();
    const where: Prisma.MediaAssetWhereInput = {
      organizationId,
      ...(search
        ? {
            OR: [
              { originalFileName: { contains: search, mode: "insensitive" } },
              ...( /^[a-f\d]{4,64}$/i.test(search)
                ? [{ sha256: { startsWith: search, mode: "insensitive" as const } }]
                : []),
            ],
          }
        : {}),
      ...(query.publicationId
        ? {
            publications: {
              some: { id: query.publicationId, organizationId },
            },
          }
        : {}),
    };
    const [total, assets] = await this.prisma.$transaction([
      this.prisma.mediaAsset.count({ where }),
      this.prisma.mediaAsset.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      items: assets.map((asset) => this.toPublic(asset)),
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.ceil(total / query.pageSize),
    };
  }

  async get(organizationId: string, assetId: string) {
    return this.toPublic(await this.findOne(organizationId, assetId));
  }

  async getSignedReadUrl(organizationId: string, assetId: string) {
    const asset = await this.findOne(organizationId, assetId);
    const url = await this.storage.createSignedReadUrl(
      asset.storageType,
      asset.storageKey,
      asset.mimeType,
      asset.originalFileName,
    );
    return {
      url,
      expiresAt: new Date(
        Date.now() + this.storage.signedUrlTtlSeconds * 1_000,
      ).toISOString(),
    };
  }

  async openContent(organizationId: string, assetId: string) {
    const asset = await this.findOne(organizationId, assetId);
    const file = await this.storage.openReadStream(
      asset.storageType,
      asset.storageKey,
      asset.mimeType,
    );
    return { ...file, originalFileName: asset.originalFileName };
  }

  async delete(organizationId: string, assetId: string) {
    const asset = await this.findOne(organizationId, assetId);
    await this.prisma.$transaction(async (transaction) => {
      const inUse = await transaction.publication.count({
        where: {
          organizationId,
          mediaAssetId: assetId,
          status: {
            in: [
              PublicationStatus.DRAFT,
              PublicationStatus.QUEUED,
              PublicationStatus.PROCESSING,
            ],
          },
        },
      });
      if (inUse > 0) {
        throw new ConflictException(
          "Media used by a draft or queued publication cannot be deleted",
        );
      }
      await transaction.publication.updateMany({
        where: { organizationId, mediaAssetId: assetId },
        data: { mediaAssetId: null },
      });
      const deleted = await transaction.mediaAsset.deleteMany({
        where: { id: assetId, organizationId },
      });
      if (deleted.count !== 1) throw new NotFoundException("Media asset not found");
    });

    let storageCleanupPending = false;
    try {
      await this.storage.deleteObject(asset.storageType, asset.storageKey);
    } catch {
      // The metadata is already removed; the orphan cleanup endpoint can retry the file deletion.
      storageCleanupPending = true;
    }
    return { id: assetId, deleted: true, storageCleanupPending };
  }

  async cleanupOrphans(organizationId: string) {
    const cutoff = new Date(Date.now() - this.orphanGraceHours * 60 * 60 * 1_000);
    const assets = await this.prisma.mediaAsset.findMany({
      where: { organizationId },
      select: { storageType: true, storageKey: true },
    });
    const knownKeys = new Map<MediaStorageType, Set<string>>();
    for (const type of [MediaStorageType.LOCAL, MediaStorageType.S3]) {
      knownKeys.set(
        type,
        new Set(
          assets.filter((asset) => asset.storageType === type).map((asset) => asset.storageKey),
        ),
      );
    }

    let scanned = 0;
    let deleted = 0;
    let failed = 0;
    for (const type of [MediaStorageType.LOCAL, MediaStorageType.S3]) {
      if (!this.storage.isConfigured(type)) continue;
      const objects = await this.storage.listObjects(type, organizationId);
      scanned += objects.length;
      const orphans = objects.filter(
        (object) =>
          object.lastModified < cutoff &&
          !knownKeys.get(type)?.has(object.key),
      );
      for (const orphan of orphans) {
        try {
          await this.storage.deleteObject(type, orphan.key);
          deleted += 1;
        } catch {
          failed += 1;
        }
      }
    }
    return { scanned, deleted, failed, graceHours: this.orphanGraceHours };
  }

  private async findOne(organizationId: string, assetId: string) {
    const asset = await this.prisma.mediaAsset.findFirst({
      where: { id: assetId, organizationId },
    });
    if (!asset) throw new NotFoundException("Media asset not found");
    return asset;
  }

  private toPublic(asset: MediaAsset) {
    return {
      id: asset.id,
      organizationId: asset.organizationId,
      originalFileName: asset.originalFileName,
      mimeType: asset.mimeType,
      mediaKind: asset.mediaKind,
      sizeBytes: asset.sizeBytes,
      sha256: asset.sha256,
      width: asset.width,
      height: asset.height,
      metadata: asset.metadata,
      createdAt: asset.createdAt,
      updatedAt: asset.updatedAt,
    };
  }
}

function safeOriginalFileName(originalName: string): string {
  const baseName = path.basename(originalName || "media-upload").replace(/\\/g, "_");
  const sanitized = baseName
    .split("")
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code >= 0x20 && code !== 0x7f;
    })
    .join("")
    .replace(/[<>:"|?*]/g, "_")
    .trim()
    .slice(0, 255);
  return sanitized || "media-upload";
}
