CREATE TYPE "AutomationTemplateScope" AS ENUM ('SYSTEM', 'ORGANIZATION');
CREATE TYPE "AutomationTemplateCategory" AS ENUM (
  'CUSTOMER_SUPPORT',
  'MODERATION',
  'LEAD_GENERATION',
  'NOTIFICATIONS'
);

CREATE TABLE "automation_templates" (
  "id" UUID NOT NULL,
  "scope" "AutomationTemplateScope" NOT NULL,
  "organization_id" UUID,
  "name" VARCHAR(120) NOT NULL,
  "description" VARCHAR(2000),
  "category" "AutomationTemplateCategory" NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "schema_version" INTEGER NOT NULL DEFAULT 1,
  "trigger_type" "AutomationTriggerType" NOT NULL,
  "conditions" JSONB NOT NULL,
  "actions" JSONB NOT NULL,
  "variables" JSONB NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "archived_at" TIMESTAMPTZ(3),
  "author_user_id" UUID,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "automation_templates_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "automation_templates_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "automation_templates_author_user_id_fkey"
    FOREIGN KEY ("author_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "automation_templates_scope_owner_check"
    CHECK (
      ("scope" = 'SYSTEM' AND "organization_id" IS NULL AND "author_user_id" IS NULL)
      OR
      ("scope" = 'ORGANIZATION' AND "organization_id" IS NOT NULL AND "author_user_id" IS NOT NULL)
    ),
  CONSTRAINT "automation_templates_version_check" CHECK ("version" > 0 AND "schema_version" > 0),
  CONSTRAINT "automation_templates_payload_size_check"
    CHECK (
      octet_length("conditions"::text)
      + octet_length("actions"::text)
      + octet_length("variables"::text) <= 32768
    )
);

CREATE INDEX "automation_templates_organization_id_active_archived_at_category_updated_at_idx"
  ON "automation_templates"("organization_id", "active", "archived_at", "category", "updated_at");
CREATE INDEX "automation_templates_scope_active_category_idx"
  ON "automation_templates"("scope", "active", "category");
CREATE UNIQUE INDEX "automation_templates_system_name_ci_key"
  ON "automation_templates"(lower("name")) WHERE "scope" = 'SYSTEM';
CREATE UNIQUE INDEX "automation_templates_organization_name_ci_key"
  ON "automation_templates"("organization_id", lower("name"))
  WHERE "scope" = 'ORGANIZATION' AND "archived_at" IS NULL;

CREATE TABLE "automation_template_versions" (
  "id" UUID NOT NULL,
  "template_id" UUID NOT NULL,
  "version" INTEGER NOT NULL,
  "schema_version" INTEGER NOT NULL,
  "snapshot" JSONB NOT NULL,
  "author_user_id" UUID,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "automation_template_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "automation_template_versions_template_id_fkey"
    FOREIGN KEY ("template_id") REFERENCES "automation_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "automation_template_versions_author_user_id_fkey"
    FOREIGN KEY ("author_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "automation_template_versions_version_check"
    CHECK ("version" > 0 AND "schema_version" > 0)
);

CREATE UNIQUE INDEX "automation_template_versions_template_id_version_key"
  ON "automation_template_versions"("template_id", "version");
CREATE INDEX "automation_template_versions_template_id_created_at_idx"
  ON "automation_template_versions"("template_id", "created_at");

INSERT INTO "automation_templates" (
  "id", "scope", "name", "description", "category", "version", "schema_version",
  "trigger_type", "conditions", "actions", "variables", "active", "updated_at"
) VALUES
  (
    '19000000-0000-4000-8000-000000000001', 'SYSTEM', 'Comment acknowledgment',
    'Reply to a comment with a short, personalized acknowledgment.', 'CUSTOMER_SUPPORT', 1, 1,
    'COMMENT_RECEIVED',
    '{"match":"ALL","rules":[]}'::jsonb,
    '[{"type":"REGISTER_EVENT"},{"type":"REPLY_COMMENT","text":"Thanks for reaching out, {{brand_name}}!"}]'::jsonb,
    '[{"key":"brand_name","label":"Brand name","type":"STRING","required":true,"minLength":1,"maxLength":80}]'::jsonb,
    true, CURRENT_TIMESTAMP
  ),
  (
    '19000000-0000-4000-8000-000000000002', 'SYSTEM', 'Flag a comment for review',
    'Notify an operator when a comment contains a moderation term.', 'MODERATION', 1, 1,
    'COMMENT_RECEIVED',
    '{"match":"ALL","rules":[{"field":"text","operator":"CONTAINS","value":"{{moderation_term}}"}]}'::jsonb,
    '[{"type":"REGISTER_EVENT"},{"type":"NOTIFY_OPERATOR","message":"Review a comment containing {{moderation_term}}."}]'::jsonb,
    '[{"key":"moderation_term","label":"Term to review","type":"STRING","required":true,"minLength":1,"maxLength":80}]'::jsonb,
    true, CURRENT_TIMESTAMP
  ),
  (
    '19000000-0000-4000-8000-000000000003', 'SYSTEM', 'Capture a comment lead',
    'Tag and notify the team about a comment that mentions a campaign keyword.', 'LEAD_GENERATION', 1, 1,
    'COMMENT_RECEIVED',
    '{"match":"ALL","rules":[{"field":"text","operator":"CONTAINS","value":"{{lead_keyword}}"}]}'::jsonb,
    '[{"type":"REGISTER_EVENT"},{"type":"TAG_CONTACT","tag":"{{contact_tag}}"},{"type":"NOTIFY_OPERATOR","message":"Potential lead from {{campaign_name}}."}]'::jsonb,
    '[{"key":"lead_keyword","label":"Lead keyword","type":"STRING","required":true,"minLength":1,"maxLength":80},{"key":"contact_tag","label":"Contact tag","type":"STRING","required":true,"minLength":1,"maxLength":64},{"key":"campaign_name","label":"Campaign name","type":"STRING","required":true,"minLength":1,"maxLength":100}]'::jsonb,
    true, CURRENT_TIMESTAMP
  ),
  (
    '19000000-0000-4000-8000-000000000004', 'SYSTEM', 'Notify on incoming messages',
    'Create an operator notification for each incoming Instagram message.', 'NOTIFICATIONS', 1, 1,
    'MESSAGE_RECEIVED',
    '{"match":"ALL","rules":[]}'::jsonb,
    '[{"type":"REGISTER_EVENT"},{"type":"NOTIFY_OPERATOR","message":"{{notification_message}}"}]'::jsonb,
    '[{"key":"notification_message","label":"Notification text","type":"STRING","required":false,"defaultValue":"New Instagram message received","minLength":1,"maxLength":300}]'::jsonb,
    true, CURRENT_TIMESTAMP
  );

INSERT INTO "automation_template_versions" (
  "id", "template_id", "version", "schema_version", "snapshot", "created_at"
)
SELECT
  (substr(md5(t."id"::text || ':version:1'), 1, 8) || '-' ||
   substr(md5(t."id"::text || ':version:1'), 9, 4) || '-4' ||
   substr(md5(t."id"::text || ':version:1'), 14, 3) || '-8' ||
   substr(md5(t."id"::text || ':version:1'), 18, 3) || '-' ||
   substr(md5(t."id"::text || ':version:1'), 21, 12))::uuid,
  t."id", t."version", t."schema_version",
  jsonb_build_object(
    'name', t."name",
    'description', t."description",
    'category', t."category",
    'schemaVersion', t."schema_version",
    'triggerType', t."trigger_type",
    'conditions', t."conditions",
    'actions', t."actions",
    'variables', t."variables",
    'active', t."active"
  ), CURRENT_TIMESTAMP
FROM "automation_templates" t
WHERE t."scope" = 'SYSTEM';
