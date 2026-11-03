import { Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { ConfigModule } from "@nestjs/config";
import { ConfigService } from "@nestjs/config";
import { LoggerModule } from "nestjs-pino";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import * as Joi from "joi";
import { AuthModule } from "./auth/auth.module";
import { HealthModule } from "./health/health.module";
import { InstagramModule } from "./instagram/instagram.module";
import { InstagramWebhooksModule } from "./webhooks/instagram-webhooks.module";
import { PublishingModule } from "./publishing/publishing.module";
import { OrganizationsModule } from "./organizations/organizations.module";
import { MediaModule } from "./media/media.module";
import { PrismaModule } from "./prisma/prisma.module";
import { HttpExceptionFilter } from "./shared/http-exception.filter";
import { JwtAuthGuard } from "./shared/guards/jwt-auth.guard";
import { TenantGuard } from "./shared/guards/tenant.guard";
import { RolesGuard } from "./shared/guards/roles.guard";
import { AuditModule } from "./audit/audit.module";
import { AuditInterceptor } from "./audit/audit.interceptor";
import { ObservabilityModule } from "./observability/observability.module";
import { MetricsInterceptor } from "./observability/metrics.interceptor";
import { createPinoHttpOptions } from "./shared/logging/pino-http.config";
import { RedisThrottlerStorage } from "./shared/guards/redis-throttler-storage";
import { RedisThrottlerStorageModule } from "./shared/guards/redis-throttler-storage.module";
import { AnalyticsModule } from "./analytics/analytics.module";

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
        PUBLICATION_WORKER_CONCURRENCY: Joi.number()
          .integer()
          .min(1)
          .max(100)
          .default(1),
        WEBHOOK_WORKER_CONCURRENCY: Joi.number()
          .integer()
          .min(1)
          .max(100)
          .default(1),
        AUTOMATION_WORKER_CONCURRENCY: Joi.number()
          .integer()
          .min(1)
          .max(100)
          .default(1),
        ANALYTICS_WORKER_CONCURRENCY: Joi.number()
          .integer()
          .min(1)
          .max(100)
          .default(1),
        ANALYTICS_MAX_ATTEMPTS: Joi.number()
          .integer()
          .min(1)
          .max(10)
          .default(3),
        ANALYTICS_ACCOUNT_RATE_LIMIT_MAX: Joi.number()
          .integer()
          .min(1)
          .max(10_000)
          .default(20),
        ANALYTICS_RATE_LIMIT_WINDOW_MS: Joi.number()
          .integer()
          .min(1_000)
          .max(86_400_000)
          .default(60_000),
        ANALYTICS_MAX_PUBLICATIONS_PER_RUN: Joi.number()
          .integer()
          .min(1)
          .max(500)
          .default(100),
        ANALYTICS_RETENTION_DAYS: Joi.number()
          .integer()
          .min(1)
          .max(3_650)
          .default(365),
        PUBLICATION_MAX_ATTEMPTS: Joi.number()
          .integer()
          .min(1)
          .max(10)
          .default(3),
        PUBLICATION_RETRY_DELAY_MS: Joi.number()
          .integer()
          .min(1)
          .max(600_000)
          .default(2_000),
        PUBLICATION_ORGANIZATION_RATE_LIMIT_MAX: Joi.number()
          .integer()
          .min(1)
          .max(10_000)
          .default(20),
        PUBLICATION_ACCOUNT_RATE_LIMIT_MAX: Joi.number()
          .integer()
          .min(1)
          .max(1_000)
          .default(5),
        PUBLICATION_RATE_LIMIT_WINDOW_MS: Joi.number()
          .integer()
          .min(1_000)
          .max(86_400_000)
          .default(60_000),
        JWT_ACCESS_SECRET: Joi.string().min(32).required(),
        JWT_ACCESS_TTL: Joi.string().default("15m"),
        REFRESH_TOKEN_TTL_DAYS: Joi.number()
          .integer()
          .min(1)
          .max(90)
          .default(30),
        CORS_ORIGIN: Joi.when("NODE_ENV", {
          is: "production",
          then: Joi.string().required().custom(validateProductionCorsOrigins),
          otherwise: Joi.string().default("http://localhost:3000"),
        }),
        TRUST_PROXY_HOPS: Joi.number().integer().min(0).max(5).default(0),
        THROTTLE_TTL_MS: Joi.number().integer().min(1_000).max(86_400_000).default(60_000),
        THROTTLE_LIMIT: Joi.number().integer().min(1).max(100_000).default(100),
        AUDIT_LOG_RETENTION_DAYS: Joi.number().integer().min(1).max(3_650).default(365),
        WEBHOOK_EVENT_RETENTION_DAYS: Joi.number().integer().min(1).max(3_650).default(365),
        RETENTION_CLEANUP_INTERVAL_MS: Joi.number().integer().min(60_000).max(604_800_000).default(86_400_000),
        INSTAGRAM_PROVIDER: Joi.string().valid("MOCK", "META").default("MOCK"),
        INSTAGRAM_DEFAULT_ORGANIZATION_ACCOUNT_LIMIT: Joi.number().integer().min(1).max(1_000).default(10),
        INSTAGRAM_DEFAULT_ORGANIZATION_GROUP_LIMIT: Joi.number().integer().min(1).max(200).default(20),
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
        META_INSTAGRAM_APP_ID: Joi.string().empty("").when("INSTAGRAM_PROVIDER", {
          is: "META",
          then: Joi.required(),
          otherwise: Joi.optional(),
        }),
        META_INSTAGRAM_APP_SECRET: Joi.string().empty("").when("INSTAGRAM_PROVIDER", {
          is: "META",
          then: Joi.required(),
          otherwise: Joi.optional(),
        }),
        META_INSTAGRAM_REDIRECT_URI: Joi.string()
          .empty("")
          .uri({ scheme: ["http", "https"] })
          .when("INSTAGRAM_PROVIDER", {
            is: "META",
            then: Joi.required(),
            otherwise: Joi.optional(),
          }),
        META_INSTAGRAM_GRAPH_API_VERSION: Joi.string()
          .empty("")
          .pattern(/^v?\d{1,2}\.\d+$/)
          .when("INSTAGRAM_PROVIDER", {
            is: "META",
            then: Joi.required(),
            otherwise: Joi.optional(),
          }),
        META_INSTAGRAM_SCOPES: Joi.string().default(
          "instagram_business_basic,instagram_business_content_publish,instagram_business_manage_comments,instagram_business_manage_messages,instagram_business_manage_insights",
        ),
        INSTAGRAM_WEBHOOK_VERIFY_TOKEN: Joi.string()
          .min(16)
          .allow("")
          .optional(),
        WEBHOOK_STORE_RAW_PAYLOAD: Joi.boolean().default(false),
        MEDIA_STORAGE_PROVIDER: Joi.when("NODE_ENV", {
          is: "production",
          then: Joi.string().valid("S3").default("S3"),
          otherwise: Joi.string().valid("LOCAL", "S3").default("LOCAL"),
        }),
        MEDIA_LOCAL_ROOT: Joi.string().default("./var/media"),
        MEDIA_PUBLIC_API_URL: Joi.string().uri({ scheme: ["http", "https"] }).default("http://localhost:3001"),
        MEDIA_MAX_FILE_SIZE_BYTES: Joi.number().integer().min(1).max(1_073_741_824).default(104_857_600),
        MEDIA_SIGNED_URL_TTL_SECONDS: Joi.number().integer().min(60).max(604_800).default(3_600),
        MEDIA_ORPHAN_GRACE_HOURS: Joi.number().integer().min(1).max(720).default(24),
        MEDIA_URL_SIGNING_SECRET: Joi.when("NODE_ENV", {
          is: "production",
          then: Joi.string().min(32).required(),
          otherwise: Joi.string().min(32).default("local-media-signing-secret-change-me-please"),
        }),
        S3_BUCKET: Joi.string().when("MEDIA_STORAGE_PROVIDER", {
          is: "S3",
          then: Joi.required(),
          otherwise: Joi.optional().allow(""),
        }),
        S3_REGION: Joi.string().default("us-east-1"),
        S3_ENDPOINT: Joi.string().uri({ scheme: ["http", "https"] }).allow("").optional(),
        S3_FORCE_PATH_STYLE: Joi.boolean().default(false),
        LOG_LEVEL: Joi.when("NODE_ENV", {
          is: "production",
          then: Joi.string().valid("fatal", "error", "warn", "info").default("info"),
          otherwise: Joi.string().valid("fatal", "error", "warn", "info", "debug", "trace", "silent").default("info"),
        }),
      }),
      validationOptions: { allowUnknown: true, abortEarly: false },
    }),
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? "info",
        ...createPinoHttpOptions(),
      },
    }),
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule, RedisThrottlerStorageModule],
      inject: [ConfigService, RedisThrottlerStorage],
      useFactory: (config: ConfigService, storage: RedisThrottlerStorage) => ({
        storage,
        throttlers: [{
          ttl: config.get<number>("THROTTLE_TTL_MS", 60_000),
          limit: config.get<number>("THROTTLE_LIMIT", 100),
        }],
      }),
    }),
    PrismaModule,
    AuditModule,
    ObservabilityModule,
    AuthModule,
    OrganizationsModule,
    InstagramModule,
    InstagramWebhooksModule,
    MediaModule,
    PublishingModule,
    AnalyticsModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: MetricsInterceptor },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: TenantGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}

function validateProductionCorsOrigins(value: string, helpers: Joi.CustomHelpers) {
  const origins = value.split(",").map((origin) => origin.trim()).filter(Boolean);
  if (origins.length === 0 || origins.some((origin) => {
    if (origin === "*") return true;
    try {
      const parsed = new URL(origin);
      return parsed.protocol !== "https:" || parsed.origin !== origin;
    } catch {
      return true;
    }
  })) {
    return helpers.error("any.invalid", { message: "Production CORS origins must be explicit HTTPS origins" });
  }
  return value;
}
