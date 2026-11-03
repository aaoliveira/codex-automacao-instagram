import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { InstagramProviderType } from "@prisma/client";
import { PrismaModule } from "../prisma/prisma.module";
import { InstagramModule } from "../instagram/instagram.module";
import { TokenEncryptionService } from "../instagram/token-encryption.service";
import { AutomationController } from "./automation.controller";
import { AutomationEngineProcessor } from "./automation-engine.processor";
import { InstagramAutomationProvider } from "./instagram-automation-provider";
import { MetaInstagramAutomationProvider } from "./meta-instagram-automation.provider";
import { MockInstagramAutomationProvider } from "./mock-instagram-automation.provider";
import { AutomationRulesService } from "./automation-rules.service";
import {
  AUTOMATION_PROVIDER,
  INSTAGRAM_AUTOMATION_QUEUE,
} from "./automation.constants";

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    InstagramModule,
    BullModule.registerQueue({ name: INSTAGRAM_AUTOMATION_QUEUE }),
  ],
  controllers: [AutomationController],
  providers: [
    AutomationRulesService,
    AutomationEngineProcessor,
    TokenEncryptionService,
    MockInstagramAutomationProvider,
    MetaInstagramAutomationProvider,
    {
      provide: AUTOMATION_PROVIDER,
      inject: [
        ConfigService,
        MockInstagramAutomationProvider,
        MetaInstagramAutomationProvider,
      ],
      useFactory: (
        config: ConfigService,
        mockProvider: MockInstagramAutomationProvider,
        metaProvider: MetaInstagramAutomationProvider,
      ): InstagramAutomationProvider =>
        config.get<InstagramProviderType>(
          "INSTAGRAM_PROVIDER",
          InstagramProviderType.MOCK,
        ) === InstagramProviderType.META
          ? metaProvider
          : mockProvider,
    },
  ],
  exports: [AutomationRulesService],
})
export class AutomationModule {}
