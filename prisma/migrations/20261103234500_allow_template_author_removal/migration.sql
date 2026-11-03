ALTER TABLE "automation_templates"
  DROP CONSTRAINT "automation_templates_scope_owner_check";

ALTER TABLE "automation_templates"
  ADD CONSTRAINT "automation_templates_scope_owner_check"
  CHECK (
    ("scope" = 'SYSTEM' AND "organization_id" IS NULL AND "author_user_id" IS NULL)
    OR
    ("scope" = 'ORGANIZATION' AND "organization_id" IS NOT NULL)
  );
