CREATE TYPE "MediaStorageType" AS ENUM ('LOCAL', 'S3');

CREATE TABLE "media_assets" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "storage_type" "MediaStorageType" NOT NULL DEFAULT 'LOCAL',
    "storage_key" VARCHAR(1024) NOT NULL,
    "original_file_name" VARCHAR(255) NOT NULL,
    "mime_type" VARCHAR(100) NOT NULL,
    "media_kind" VARCHAR(16) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "metadata" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "media_assets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "media_assets_organization_id_id_key" ON "media_assets"("organization_id", "id");
CREATE INDEX "media_assets_organization_id_created_at_idx" ON "media_assets"("organization_id", "created_at");
CREATE INDEX "media_assets_organization_id_sha256_idx" ON "media_assets"("organization_id", "sha256");
CREATE INDEX "media_assets_organization_id_original_file_name_idx" ON "media_assets"("organization_id", "original_file_name");

ALTER TABLE "media_assets"
ADD CONSTRAINT "media_assets_organization_id_fkey"
FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "publications" ALTER COLUMN "media_url" DROP NOT NULL;
ALTER TABLE "publications" ADD COLUMN "media_asset_id" UUID;
CREATE INDEX "publications_media_asset_id_idx" ON "publications"("media_asset_id");

ALTER TABLE "publications"
ADD CONSTRAINT "publications_organization_id_media_asset_id_fkey"
FOREIGN KEY ("organization_id", "media_asset_id") REFERENCES "media_assets"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
