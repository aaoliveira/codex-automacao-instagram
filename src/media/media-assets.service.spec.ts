import { ConfigService } from "@nestjs/config";
import { MediaStorageType } from "@prisma/client";
import { MediaAssetsService } from "./media-assets.service";
import { MediaStorageService } from "./storage/media-storage.service";
import { PrismaService } from "../prisma/prisma.service";

describe("MediaAssetsService orphan cleanup", () => {
  it("deletes only unreferenced objects beyond the tenant grace period", async () => {
    const organizationId = "organization-1";
    const cutoff = Date.now() - 60 * 60 * 1_000;
    const known = `${organizationId}/known.png`;
    const orphan = `${organizationId}/orphan.png`;
    const recent = `${organizationId}/recent.png`;
    const prisma = {
      mediaAsset: {
        findMany: jest.fn().mockResolvedValue([
          { storageType: MediaStorageType.LOCAL, storageKey: known },
        ]),
      },
    } as unknown as PrismaService;
    const storage = {
      activeType: MediaStorageType.LOCAL,
      signedUrlTtlSeconds: 3_600,
      isConfigured: jest.fn((type: MediaStorageType) => type === MediaStorageType.LOCAL),
      listObjects: jest.fn().mockResolvedValue([
        { key: known, lastModified: new Date(cutoff - 60_000), sizeBytes: 1 },
        { key: orphan, lastModified: new Date(cutoff - 60_000), sizeBytes: 1 },
        { key: recent, lastModified: new Date(cutoff + 60_000), sizeBytes: 1 },
      ]),
      deleteObject: jest.fn().mockResolvedValue(undefined),
    } as unknown as MediaStorageService;
    const config = {
      get: jest.fn((key: string, fallback: unknown) =>
        key === "MEDIA_ORPHAN_GRACE_HOURS" ? 1 : fallback,
      ),
    } as unknown as ConfigService;
    const service = new MediaAssetsService(prisma, storage, config);

    const result = await service.cleanupOrphans(organizationId);

    expect(result).toMatchObject({ scanned: 3, deleted: 1, failed: 0, graceHours: 1 });
    expect(storage.listObjects).toHaveBeenCalledWith(
      MediaStorageType.LOCAL,
      organizationId,
    );
    expect(storage.deleteObject).toHaveBeenCalledTimes(1);
    expect(storage.deleteObject).toHaveBeenCalledWith(
      MediaStorageType.LOCAL,
      orphan,
    );
    expect(storage.deleteObject).not.toHaveBeenCalledWith(
      MediaStorageType.LOCAL,
      known,
    );
    expect(storage.deleteObject).not.toHaveBeenCalledWith(
      MediaStorageType.LOCAL,
      recent,
    );
  });
});
