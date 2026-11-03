import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { InstagramProviderType } from "@prisma/client";
import { PrismaModule } from "../prisma/prisma.module";
import { TokenEncryptionService } from "../instagram/token-encryption.service";
import { InstagramPublicationProcessor } from "./instagram-publication.processor";
import {
  INSTAGRAM_PUBLISHING_PROVIDER,
  InstagramPublishingProvider,
} from "./instagram-publishing-provider";
import { MetaInstagramPublishingProvider } from "./meta-instagram-publishing.provider";
import { MockInstagramPublishingProvider } from "./mock-instagram-publishing.provider";
import { INSTAGRAM_PUBLICATION_QUEUE } from "./publication.constants";
import { PublishingController } from "./publishing.controller";
import { PublishingService } from "./publishing.service";
import { QueueOperationsController } from "./queue-operations.controller";
import { PublicationRateLimiter } from "./publication-rate-limiter";
import { MediaModule } from "../media/media.module";
import { InstagramModule } from "../instagram/instagram.module";

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    MediaModule,
    InstagramModule,
    BullModule.registerQueue({ name: INSTAGRAM_PUBLICATION_QUEUE }),
  ],
  controllers: [PublishingController, QueueOperationsController],
  providers: [
    PublishingService,
    InstagramPublicationProcessor,
    PublicationRateLimiter,
    TokenEncryptionService,
    MockInstagramPublishingProvider,
    MetaInstagramPublishingProvider,
    {
      provide: INSTAGRAM_PUBLISHING_PROVIDER,
      inject: [
        ConfigService,
        MockInstagramPublishingProvider,
        MetaInstagramPublishingProvider,
      ],
      useFactory: (
        config: ConfigService,
        mockProvider: MockInstagramPublishingProvider,
        metaProvider: MetaInstagramPublishingProvider,
      ): InstagramPublishingProvider =>
        config.get<InstagramProviderType>(
          "INSTAGRAM_PROVIDER",
          InstagramProviderType.MOCK,
        ) === InstagramProviderType.META
          ? metaProvider
          : mockProvider,
    },
  ],
})
export class PublishingModule {}
