import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { ConfigModule } from "@nestjs/config";
import { InstagramProviderType } from "@prisma/client";
import { InstagramModule } from "../instagram/instagram.module";
import { TokenEncryptionService } from "../instagram/token-encryption.service";
import { PrismaModule } from "../prisma/prisma.module";
import { PUBLICATION_ANALYTICS_QUEUE } from "./analytics.constants";
import { AnalyticsController } from "./analytics.controller";
import { AnalyticsProcessor } from "./analytics.processor";
import { AnalyticsRateLimiter } from "./analytics-rate-limiter";
import { AnalyticsService } from "./analytics.service";
import {
  ANALYTICS_INSIGHTS_PROVIDER,
  InstagramInsightsProvider,
} from "./insights-provider";
import { MetaInsightsProvider } from "./meta-insights.provider";
import { MockInsightsProvider } from "./mock-insights.provider";

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    InstagramModule,
    BullModule.registerQueue({ name: PUBLICATION_ANALYTICS_QUEUE }),
  ],
  controllers: [AnalyticsController],
  providers: [
    AnalyticsService,
    AnalyticsProcessor,
    AnalyticsRateLimiter,
    TokenEncryptionService,
    MockInsightsProvider,
    MetaInsightsProvider,
    {
      provide: ANALYTICS_INSIGHTS_PROVIDER,
      inject: [MockInsightsProvider, MetaInsightsProvider],
      useFactory: (
        mock: MockInsightsProvider,
        meta: MetaInsightsProvider,
      ): Record<InstagramProviderType, InstagramInsightsProvider> => ({
        MOCK: mock,
        META: meta,
      }),
    },
  ],
})
export class AnalyticsModule {}
