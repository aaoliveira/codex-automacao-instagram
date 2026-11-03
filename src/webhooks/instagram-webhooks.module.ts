import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { PrismaModule } from "../prisma/prisma.module";
import {
  InstagramChangeWebhookHandler,
  InstagramMessagingWebhookHandler,
  InstagramUnknownWebhookHandler,
} from "./instagram-webhook-event-handlers";
import { InstagramWebhookProcessor } from "./instagram-webhook.processor";
import { InstagramWebhookSecurityService } from "./instagram-webhook-security.service";
import { InstagramWebhooksController } from "./instagram-webhooks.controller";
import { InstagramWebhooksService } from "./instagram-webhooks.service";
import { InstagramEventsController } from "./instagram-events.controller";
import { InstagramEventsService } from "./instagram-events.service";
import { INSTAGRAM_WEBHOOK_QUEUE } from "./webhook.constants";
import { AutomationModule } from "../automations/automation.module";
import { INSTAGRAM_AUTOMATION_QUEUE } from "../automations/automation.constants";

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    AutomationModule,
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const redisUrl = new URL(config.getOrThrow<string>("REDIS_URL"));
        return {
          connection: {
            host: redisUrl.hostname,
            port: Number(redisUrl.port || 6379),
            username: redisUrl.username
              ? decodeURIComponent(redisUrl.username)
              : undefined,
            password: redisUrl.password
              ? decodeURIComponent(redisUrl.password)
              : undefined,
            db:
              redisUrl.pathname.length > 1
                ? Number(redisUrl.pathname.slice(1))
                : 0,
            maxRetriesPerRequest: null,
            ...(redisUrl.protocol === "rediss:" ? { tls: {} } : {}),
          },
        };
      },
    }),
    BullModule.registerQueue(
      { name: INSTAGRAM_WEBHOOK_QUEUE },
      { name: INSTAGRAM_AUTOMATION_QUEUE },
    ),
  ],
  controllers: [InstagramWebhooksController, InstagramEventsController],
  providers: [
    InstagramWebhooksService,
    InstagramEventsService,
    InstagramWebhookSecurityService,
    InstagramWebhookProcessor,
    InstagramChangeWebhookHandler,
    InstagramMessagingWebhookHandler,
    InstagramUnknownWebhookHandler,
  ],
  exports: [InstagramWebhooksService],
})
export class InstagramWebhooksModule {}
