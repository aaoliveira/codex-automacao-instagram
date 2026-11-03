-- CreateEnum
CREATE TYPE "PublicationStatus" AS ENUM ('DRAFT', 'QUEUED', 'PROCESSING', 'PUBLISHED', 'FAILED', 'CANCELED');

-- CreateEnum
CREATE TYPE "PublicationMediaType" AS ENUM ('PHOTO', 'VIDEO', 'REEL');

-- CreateTable
CREATE TABLE "publications" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "instagram_account_id" UUID NOT NULL,
    "idempotency_key" VARCHAR(128),
    "media_type" "PublicationMediaType" NOT NULL,
    "media_url" TEXT NOT NULL,
    "caption" VARCHAR(2200),
    "alt_text" VARCHAR(1000),
    "share_to_feed" BOOLEAN,
    "status" "PublicationStatus" NOT NULL DEFAULT 'DRAFT',
    "external_container_id" VARCHAR(255),
    "external_media_id" VARCHAR(255),
    "error_code" VARCHAR(100),
    "error_message" VARCHAR(500),
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "queued_at" TIMESTAMPTZ(3),
    "processing_started_at" TIMESTAMPTZ(3),
    "publish_attempted_at" TIMESTAMPTZ(3),
    "published_at" TIMESTAMPTZ(3),
    "canceled_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "publications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "publications_organization_id_status_created_at_idx" ON "publications"("organization_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "publications_instagram_account_id_created_at_idx" ON "publications"("instagram_account_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "publications_organization_id_idempotency_key_key" ON "publications"("organization_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "instagram_accounts_organization_id_id_key" ON "instagram_accounts"("organization_id", "id");

-- AddForeignKey
ALTER TABLE "publications" ADD CONSTRAINT "publications_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publications" ADD CONSTRAINT "publications_organization_id_instagram_account_id_fkey" FOREIGN KEY ("organization_id", "instagram_account_id") REFERENCES "instagram_accounts"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

