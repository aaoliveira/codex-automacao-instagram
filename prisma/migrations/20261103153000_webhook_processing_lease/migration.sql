-- AlterTable
ALTER TABLE "webhook_events"
ADD COLUMN "processing_started_at" TIMESTAMPTZ(3);
