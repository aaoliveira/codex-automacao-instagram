-- CreateEnum
CREATE TYPE "AnalyticsDataOrigin" AS ENUM ('META', 'DERIVED', 'MOCK');

-- CreateEnum
CREATE TYPE "AnalyticsSnapshotStatus" AS ENUM ('AVAILABLE', 'UNAVAILABLE', 'PERMISSION_MISSING', 'NOT_SUPPORTED', 'WINDOW_EXPIRED', 'TRANSIENT_ERROR');

-- CreateEnum
CREATE TYPE "AnalyticsSyncStatus" AS ENUM ('QUEUED', 'PROCESSING', 'COMPLETED', 'PARTIAL', 'FAILED');

-- CreateEnum
CREATE TYPE "AnalyticsMetricGranularity" AS ENUM ('PUBLICATION_LIFETIME');

-- CreateTable
CREATE TABLE "metric_definitions" (
    "key" VARCHAR(80) NOT NULL,
    "label" VARCHAR(120) NOT NULL,
    "definition" VARCHAR(1000) NOT NULL,
    "unit" VARCHAR(32) NOT NULL,
    "origin" "AnalyticsDataOrigin" NOT NULL,
    "granularity" "AnalyticsMetricGranularity" NOT NULL DEFAULT 'PUBLICATION_LIFETIME',
    "available_media_types" "PublicationMediaType"[] DEFAULT ARRAY[]::"PublicationMediaType"[],
    "required_permissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "meta_metric" VARCHAR(80),
    "formula" VARCHAR(500),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "metric_definitions_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "analytics_sync_runs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "instagram_account_id" UUID NOT NULL,
    "requested_by_user_id" UUID,
    "idempotency_key" VARCHAR(128) NOT NULL,
    "start_date" TIMESTAMPTZ(3) NOT NULL,
    "end_date" TIMESTAMPTZ(3) NOT NULL,
    "timezone" VARCHAR(64) NOT NULL,
    "status" "AnalyticsSyncStatus" NOT NULL DEFAULT 'QUEUED',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "requested_count" INTEGER NOT NULL DEFAULT 0,
    "available_count" INTEGER NOT NULL DEFAULT 0,
    "unavailable_count" INTEGER NOT NULL DEFAULT 0,
    "error_code" VARCHAR(80),
    "started_at" TIMESTAMPTZ(3),
    "finished_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "analytics_sync_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "publication_insight_snapshots" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "instagram_account_id" UUID NOT NULL,
    "publication_id" UUID NOT NULL,
    "sync_run_id" UUID NOT NULL,
    "metric_key" VARCHAR(80) NOT NULL,
    "media_type" "PublicationMediaType" NOT NULL,
    "origin" "AnalyticsDataOrigin" NOT NULL,
    "status" "AnalyticsSnapshotStatus" NOT NULL,
    "value" DECIMAL(24,8),
    "reason_code" VARCHAR(80),
    "captured_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "period_start" TIMESTAMPTZ(3),
    "period_end" TIMESTAMPTZ(3),

    CONSTRAINT "publication_insight_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "metric_definitions_active_origin_key_idx" ON "metric_definitions"("active", "origin", "key");

-- CreateIndex
CREATE INDEX "analytics_sync_runs_organization_id_instagram_account_id_cr_idx" ON "analytics_sync_runs"("organization_id", "instagram_account_id", "created_at");

-- CreateIndex
CREATE INDEX "analytics_sync_runs_organization_id_status_created_at_idx" ON "analytics_sync_runs"("organization_id", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "analytics_sync_runs_organization_id_id_key" ON "analytics_sync_runs"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "analytics_sync_runs_organization_id_idempotency_key_key" ON "analytics_sync_runs"("organization_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "publication_insight_snapshots_organization_id_instagram_acc_idx" ON "publication_insight_snapshots"("organization_id", "instagram_account_id", "captured_at");

-- CreateIndex
CREATE INDEX "publication_insight_snapshots_organization_id_publication_i_idx" ON "publication_insight_snapshots"("organization_id", "publication_id", "captured_at");

-- CreateIndex
CREATE INDEX "publication_insight_snapshots_organization_id_metric_key_ca_idx" ON "publication_insight_snapshots"("organization_id", "metric_key", "captured_at");

-- CreateIndex
CREATE INDEX "publication_insight_snapshots_organization_id_media_type_ca_idx" ON "publication_insight_snapshots"("organization_id", "media_type", "captured_at");

-- CreateIndex
CREATE UNIQUE INDEX "publication_insight_snapshots_sync_run_id_publication_id_me_key" ON "publication_insight_snapshots"("sync_run_id", "publication_id", "metric_key");

-- CreateIndex
CREATE UNIQUE INDEX "publications_organization_id_id_key" ON "publications"("organization_id", "id");

-- RenameForeignKey
ALTER TABLE "instagram_account_access" RENAME CONSTRAINT "instagram_account_access_account_fkey" TO "instagram_account_access_organization_id_instagram_account_fkey";

-- RenameForeignKey
ALTER TABLE "instagram_account_access" RENAME CONSTRAINT "instagram_account_access_membership_fkey" TO "instagram_account_access_organization_id_membership_id_fkey";

-- RenameForeignKey
ALTER TABLE "instagram_account_preferences" RENAME CONSTRAINT "instagram_account_preferences_account_fkey" TO "instagram_account_preferences_organization_id_instagram_ac_fkey";

-- RenameForeignKey
ALTER TABLE "instagram_account_preferences" RENAME CONSTRAINT "instagram_account_preferences_membership_fkey" TO "instagram_account_preferences_user_id_organization_id_fkey";

-- AddForeignKey
ALTER TABLE "analytics_sync_runs" ADD CONSTRAINT "analytics_sync_runs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analytics_sync_runs" ADD CONSTRAINT "analytics_sync_runs_organization_id_instagram_account_id_fkey" FOREIGN KEY ("organization_id", "instagram_account_id") REFERENCES "instagram_accounts"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analytics_sync_runs" ADD CONSTRAINT "analytics_sync_runs_requested_by_user_id_fkey" FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publication_insight_snapshots" ADD CONSTRAINT "publication_insight_snapshots_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publication_insight_snapshots" ADD CONSTRAINT "publication_insight_snapshots_organization_id_instagram_ac_fkey" FOREIGN KEY ("organization_id", "instagram_account_id") REFERENCES "instagram_accounts"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publication_insight_snapshots" ADD CONSTRAINT "publication_insight_snapshots_organization_id_publication__fkey" FOREIGN KEY ("organization_id", "publication_id") REFERENCES "publications"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publication_insight_snapshots" ADD CONSTRAINT "publication_insight_snapshots_organization_id_sync_run_id_fkey" FOREIGN KEY ("organization_id", "sync_run_id") REFERENCES "analytics_sync_runs"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publication_insight_snapshots" ADD CONSTRAINT "publication_insight_snapshots_metric_key_fkey" FOREIGN KEY ("metric_key") REFERENCES "metric_definitions"("key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "automation_templates_organization_id_active_archived_at_categor" RENAME TO "automation_templates_organization_id_active_archived_at_cat_idx";

-- RenameIndex
ALTER INDEX "instagram_account_access_organization_id_membership_id_level_id" RENAME TO "instagram_account_access_organization_id_membership_id_leve_idx";

-- RenameIndex
ALTER INDEX "instagram_account_preferences_organization_user_favorite_idx" RENAME TO "instagram_account_preferences_organization_id_user_id_favor_idx";

-- RenameIndex
ALTER INDEX "instagram_accounts_organization_id_tags_idx" RENAME TO "instagram_accounts_tags_idx";

INSERT INTO "metric_definitions" ("key", "label", "definition", "unit", "origin", "granularity", "available_media_types", "required_permissions", "meta_metric", "formula", "active", "created_at", "updated_at") VALUES
('reach', 'Reach', 'Number of unique accounts reached for the published media, when returned by Instagram.', 'accounts', 'META', 'PUBLICATION_LIFETIME', ARRAY['PHOTO'::"PublicationMediaType", 'REEL'::"PublicationMediaType"], ARRAY['instagram_business_manage_insights']::TEXT[], 'reach', NULL, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('views', 'Views', 'Views reported by Instagram for the published media, when supported and returned.', 'views', 'META', 'PUBLICATION_LIFETIME', ARRAY['PHOTO'::"PublicationMediaType", 'REEL'::"PublicationMediaType"], ARRAY['instagram_business_manage_insights']::TEXT[], 'views', NULL, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('likes', 'Likes', 'Like count reported by Instagram for the published media.', 'interactions', 'META', 'PUBLICATION_LIFETIME', ARRAY['PHOTO'::"PublicationMediaType", 'REEL'::"PublicationMediaType"], ARRAY['instagram_business_manage_insights']::TEXT[], 'likes', NULL, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('comments', 'Comments', 'Comment count reported by Instagram for the published media.', 'interactions', 'META', 'PUBLICATION_LIFETIME', ARRAY['PHOTO'::"PublicationMediaType", 'REEL'::"PublicationMediaType"], ARRAY['instagram_business_manage_insights']::TEXT[], 'comments', NULL, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('saved', 'Saved', 'Save count reported by Instagram for the published media.', 'interactions', 'META', 'PUBLICATION_LIFETIME', ARRAY['PHOTO'::"PublicationMediaType", 'REEL'::"PublicationMediaType"], ARRAY['instagram_business_manage_insights']::TEXT[], 'saved', NULL, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('shares', 'Shares', 'Share count reported by Instagram for the published media.', 'interactions', 'META', 'PUBLICATION_LIFETIME', ARRAY['PHOTO'::"PublicationMediaType", 'REEL'::"PublicationMediaType"], ARRAY['instagram_business_manage_insights']::TEXT[], 'shares', NULL, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('total_interactions', 'Total interactions', 'Total interactions value reported by Instagram for the published media.', 'interactions', 'META', 'PUBLICATION_LIFETIME', ARRAY['PHOTO'::"PublicationMediaType", 'REEL'::"PublicationMediaType"], ARRAY['instagram_business_manage_insights']::TEXT[], 'total_interactions', NULL, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('engagement_rate_by_reach', 'Engagement rate by reach', 'Derived ratio of Instagram-reported total interactions to Instagram-reported reach.', 'percent', 'DERIVED', 'PUBLICATION_LIFETIME', ARRAY['PHOTO'::"PublicationMediaType", 'VIDEO'::"PublicationMediaType", 'REEL'::"PublicationMediaType"], ARRAY['instagram_business_manage_insights']::TEXT[], NULL, 'total_interactions / reach * 100; null when either input is unavailable or reach is zero', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
