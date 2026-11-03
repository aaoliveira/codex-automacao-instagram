-- CreateEnum
CREATE TYPE "AutomationTriggerType" AS ENUM ('COMMENT_RECEIVED', 'MESSAGE_RECEIVED', 'WEBHOOK_EVENT_RECEIVED');

-- CreateEnum
CREATE TYPE "AutomationExecutionStatus" AS ENUM ('PROCESSING', 'SUCCESS', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "AutomationActionType" AS ENUM ('REGISTER_EVENT', 'SEND_MESSAGE', 'REPLY_COMMENT', 'TAG_CONTACT', 'NOTIFY_OPERATOR');

-- CreateEnum
CREATE TYPE "AutomationActionStatus" AS ENUM ('PROCESSING', 'SUCCESS', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "automation_rules" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "instagram_account_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "trigger_type" "AutomationTriggerType" NOT NULL,
    "conditions" JSONB NOT NULL,
    "actions" JSONB NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "automation_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_executions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "instagram_account_id" UUID NOT NULL,
    "automation_rule_id" UUID NOT NULL,
    "webhook_event_id" UUID NOT NULL,
    "status" "AutomationExecutionStatus" NOT NULL DEFAULT 'PROCESSING',
    "result" JSONB,
    "error_code" VARCHAR(100),
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "automation_executions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_action_executions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "automation_execution_id" UUID NOT NULL,
    "action_index" INTEGER NOT NULL,
    "action_type" "AutomationActionType" NOT NULL,
    "status" "AutomationActionStatus" NOT NULL DEFAULT 'PROCESSING',
    "idempotency_key" CHAR(64) NOT NULL,
    "effect_key" CHAR(64),
    "result" JSONB,
    "error_code" VARCHAR(100),
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "automation_action_executions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_contact_tags" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "instagram_account_id" UUID NOT NULL,
    "automation_rule_id" UUID NOT NULL,
    "external_contact_id" VARCHAR(255) NOT NULL,
    "tag" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "automation_contact_tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_notifications" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "instagram_account_id" UUID NOT NULL,
    "automation_rule_id" UUID NOT NULL,
    "webhook_event_id" UUID NOT NULL,
    "action_index" INTEGER NOT NULL,
    "message" VARCHAR(500) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "read_at" TIMESTAMPTZ(3),

    CONSTRAINT "automation_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "automation_rules_organization_id_instagram_account_id_activ_idx" ON "automation_rules"("organization_id", "instagram_account_id", "active", "deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "automation_rules_organization_id_id_key" ON "automation_rules"("organization_id", "id");

-- CreateIndex
CREATE INDEX "automation_executions_organization_id_created_at_idx" ON "automation_executions"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "automation_executions_organization_id_status_created_at_idx" ON "automation_executions"("organization_id", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "automation_executions_organization_id_automation_rule_id_we_key" ON "automation_executions"("organization_id", "automation_rule_id", "webhook_event_id");

-- CreateIndex
CREATE UNIQUE INDEX "automation_executions_organization_id_id_key" ON "automation_executions"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "automation_action_executions_idempotency_key_key" ON "automation_action_executions"("idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "automation_action_executions_effect_key_key" ON "automation_action_executions"("effect_key");

-- CreateIndex
CREATE INDEX "automation_action_executions_organization_id_status_created_idx" ON "automation_action_executions"("organization_id", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "automation_action_executions_automation_execution_id_action_key" ON "automation_action_executions"("automation_execution_id", "action_index");

-- CreateIndex
CREATE INDEX "automation_contact_tags_organization_id_external_contact_id_idx" ON "automation_contact_tags"("organization_id", "external_contact_id");

-- CreateIndex
CREATE UNIQUE INDEX "automation_contact_tags_organization_id_instagram_account_i_key" ON "automation_contact_tags"("organization_id", "instagram_account_id", "external_contact_id", "tag");

-- CreateIndex
CREATE INDEX "automation_notifications_organization_id_read_at_created_at_idx" ON "automation_notifications"("organization_id", "read_at", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "automation_notifications_automation_rule_id_webhook_event_i_key" ON "automation_notifications"("automation_rule_id", "webhook_event_id", "action_index");

-- AddForeignKey
ALTER TABLE "automation_rules" ADD CONSTRAINT "automation_rules_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_rules" ADD CONSTRAINT "automation_rules_organization_id_instagram_account_id_fkey" FOREIGN KEY ("organization_id", "instagram_account_id") REFERENCES "instagram_accounts"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_executions" ADD CONSTRAINT "automation_executions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_executions" ADD CONSTRAINT "automation_executions_organization_id_instagram_account_id_fkey" FOREIGN KEY ("organization_id", "instagram_account_id") REFERENCES "instagram_accounts"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_executions" ADD CONSTRAINT "automation_executions_organization_id_automation_rule_id_fkey" FOREIGN KEY ("organization_id", "automation_rule_id") REFERENCES "automation_rules"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_executions" ADD CONSTRAINT "automation_executions_webhook_event_id_fkey" FOREIGN KEY ("webhook_event_id") REFERENCES "webhook_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_action_executions" ADD CONSTRAINT "automation_action_executions_organization_id_automation_ex_fkey" FOREIGN KEY ("organization_id", "automation_execution_id") REFERENCES "automation_executions"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_contact_tags" ADD CONSTRAINT "automation_contact_tags_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_contact_tags" ADD CONSTRAINT "automation_contact_tags_organization_id_instagram_account__fkey" FOREIGN KEY ("organization_id", "instagram_account_id") REFERENCES "instagram_accounts"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_contact_tags" ADD CONSTRAINT "automation_contact_tags_organization_id_automation_rule_id_fkey" FOREIGN KEY ("organization_id", "automation_rule_id") REFERENCES "automation_rules"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_notifications" ADD CONSTRAINT "automation_notifications_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_notifications" ADD CONSTRAINT "automation_notifications_organization_id_instagram_account_fkey" FOREIGN KEY ("organization_id", "instagram_account_id") REFERENCES "instagram_accounts"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_notifications" ADD CONSTRAINT "automation_notifications_organization_id_automation_rule_i_fkey" FOREIGN KEY ("organization_id", "automation_rule_id") REFERENCES "automation_rules"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_notifications" ADD CONSTRAINT "automation_notifications_webhook_event_id_fkey" FOREIGN KEY ("webhook_event_id") REFERENCES "webhook_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
