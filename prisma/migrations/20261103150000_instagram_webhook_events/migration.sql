-- CreateEnum
CREATE TYPE "WebhookProvider" AS ENUM ('META', 'MOCK');

-- CreateEnum
CREATE TYPE "WebhookEventStatus" AS ENUM ('RECEIVED', 'QUEUED', 'PROCESSING', 'PROCESSED', 'FAILED');

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" UUID NOT NULL,
    "provider" "WebhookProvider" NOT NULL,
    "external_event_id" VARCHAR(255),
    "dedupe_key" CHAR(64) NOT NULL,
    "event_type" VARCHAR(120) NOT NULL,
    "normalized_payload" JSONB NOT NULL,
    "raw_payload" JSONB,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(3),
    "status" "WebhookEventStatus" NOT NULL DEFAULT 'RECEIVED',
    "error" VARCHAR(500),
    "processing_attempts" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "webhook_events_dedupe_key_key" ON "webhook_events"("dedupe_key");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_events_provider_external_event_id_key" ON "webhook_events"("provider", "external_event_id");

-- CreateIndex
CREATE INDEX "webhook_events_provider_status_received_at_idx" ON "webhook_events"("provider", "status", "received_at");
