ALTER TABLE "publications"
  ADD COLUMN "scheduled_at" TIMESTAMPTZ(3),
  ADD COLUMN "schedule_timezone" VARCHAR(64);

CREATE INDEX "publications_organization_id_status_scheduled_at_idx"
  ON "publications"("organization_id", "status", "scheduled_at");
