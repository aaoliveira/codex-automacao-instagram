import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { PrismaModule } from "../prisma/prisma.module";
import {
  LOCAL_MEDIA_STORAGE_PROVIDER,
  S3_MEDIA_STORAGE_PROVIDER,
} from "./media.constants";
import { MediaAssetsController, LocalMediaDeliveryController } from "./media-assets.controller";
import { MediaAssetsService } from "./media-assets.service";
import { LocalStorageProvider } from "./storage/local-storage.provider";
import { MediaStorageService } from "./storage/media-storage.service";
import { S3StorageProvider } from "./storage/s3-storage.provider";

@Module({
  imports: [ConfigModule, PrismaModule],
  controllers: [MediaAssetsController, LocalMediaDeliveryController],
  providers: [
    LocalStorageProvider,
    S3StorageProvider,
    {
      provide: LOCAL_MEDIA_STORAGE_PROVIDER,
      useExisting: LocalStorageProvider,
    },
    {
      provide: S3_MEDIA_STORAGE_PROVIDER,
      useExisting: S3StorageProvider,
    },
    MediaStorageService,
    MediaAssetsService,
  ],
  exports: [MediaStorageService],
})
export class MediaModule {}
