import { Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { ConfigModule } from "@nestjs/config";
import { LoggerModule } from "nestjs-pino";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import * as Joi from "joi";
import { AuthModule } from "./auth/auth.module";
import { HealthModule } from "./health/health.module";
import { InstagramModule } from "./instagram/instagram.module";
import { InstagramWebhooksModule } from "./webhooks/instagram-webhooks.module";
import { PublishingModule } from "./publishing/publishing.module";
import { OrganizationsModule } from "./organizations/organizations.module";
import { PrismaModule } from "./prisma/prisma.module";
import { HttpExceptionFilter } from "./shared/http-exception.filter";
import { JwtAuthGuard } from "./shared/guards/jwt-auth.guard";
import { TenantGuard } from "./shared/guards/tenant.guard";
import { RolesGuard } from "./shared/guards/roles.guard";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: Joi.object({
        NODE_ENV: Joi.string()
          .valid("development", "test", "production")
          .default("development"),
        PORT: Joi.number().port().default(3001),
        DATABASE_URL: Joi.string().required(),
        REDIS_URL: Joi.string()
          .uri({ scheme: ["redis", "rediss"] })
          .required(),
        JWT_ACCESS_SECRET: Joi.string().min(32).required(),
        JWT_ACCESS_TTL: Joi.string().default("15m"),
        REFRESH_TOKEN_TTL_DAYS: Joi.number()
          .integer()
          .min(1)
          .max(90)
          .default(30),
        CORS_ORIGIN: Joi.string().default("http://localhost:3000"),
        INSTAGRAM_PROVIDER: Joi.string().valid("MOCK", "META").default("MOCK"),
        INSTAGRAM_TOKEN_ENCRYPTION_KEY: Joi.when("NODE_ENV", {
          is: "production",
          then: Joi.string()
            .custom((value, helpers) =>
              Buffer.from(value, "base64").length === 32
                ? value
                : helpers.error("any.invalid"),
            )
            .required(),
          otherwise: Joi.string()
            .custom((value, helpers) =>
              Buffer.from(value, "base64").length === 32
                ? value
                : helpers.error("any.invalid"),
            )
            .default("BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc="),
        }),
        META_INSTAGRAM_APP_ID: Joi.string().when("INSTAGRAM_PROVIDER", {
          is: "META",
          then: Joi.required(),
          otherwise: Joi.optional(),
        }),
        META_INSTAGRAM_APP_SECRET: Joi.string().when("INSTAGRAM_PROVIDER", {
          is: "META",
          then: Joi.required(),
          otherwise: Joi.optional(),
        }),
        META_INSTAGRAM_REDIRECT_URI: Joi.string()
          .uri({ scheme: ["http", "https"] })
          .when("INSTAGRAM_PROVIDER", {
            is: "META",
            then: Joi.required(),
            otherwise: Joi.optional(),
          }),
        META_INSTAGRAM_GRAPH_API_VERSION: Joi.string()
          .pattern(/^v?\d{1,2}\.\d+$/)
          .when("INSTAGRAM_PROVIDER", {
            is: "META",
            then: Joi.required(),
            otherwise: Joi.optional(),
          }),
        META_INSTAGRAM_SCOPES: Joi.string().default(
          "instagram_business_basic,instagram_business_content_publish,instagram_business_manage_comments,instagram_business_manage_messages",
        ),
        INSTAGRAM_WEBHOOK_VERIFY_TOKEN: Joi.string()
          .min(16)
          .allow("")
          .optional(),
        WEBHOOK_STORE_RAW_PAYLOAD: Joi.boolean().default(false),
        LOG_LEVEL: Joi.string()
          .valid("fatal", "error", "warn", "info", "debug", "trace", "silent")
          .default("info"),
      }),
      validationOptions: { allowUnknown: true, abortEarly: false },
    }),
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? "info",
        redact: {
          paths: [
            "req.headers.authorization",
            "req.headers.cookie",
            "req.body.password",
            "req.body.refreshToken",
            "req.body.refresh_token",
            "res.headers.set-cookie",
          ],
          censor: "[REDACTED]",
        },
        serializers: {
          req(request) {
            return {
              id: request.id,
              method: request.method,
              url: request.url?.split("?")[0],
            };
          },
          res(response) {
            return { statusCode: response.statusCode };
          },
        },
      },
    }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    PrismaModule,
    AuthModule,
    OrganizationsModule,
    InstagramModule,
    InstagramWebhooksModule,
    PublishingModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: TenantGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
