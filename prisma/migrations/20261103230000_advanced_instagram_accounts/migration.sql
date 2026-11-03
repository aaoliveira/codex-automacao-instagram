CREATE TYPE "InstagramAccountAccessLevel" AS ENUM ('VIEW', 'MANAGE');

ALTER TABLE "memberships"
  ADD CONSTRAINT "memberships_organization_id_id_key" UNIQUE ("organization_id", "id");

ALTER TABLE "instagram_accounts"
  ADD COLUMN "group_id" UUID,
  ADD COLUMN "internal_alias" VARCHAR(100),
  ADD COLUMN "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

CREATE TABLE "instagram_account_groups" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "name" VARCHAR(80) NOT NULL,
  "description" VARCHAR(240),
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "instagram_account_groups_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "instagram_account_groups_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "instagram_account_groups_organization_id_id_key" UNIQUE ("organization_id", "id"),
  CONSTRAINT "instagram_account_groups_organization_id_name_key" UNIQUE ("organization_id", "name")
);
CREATE INDEX "instagram_account_groups_organization_id_sort_order_name_idx"
  ON "instagram_account_groups"("organization_id", "sort_order", "name");
CREATE UNIQUE INDEX "instagram_account_groups_organization_name_ci_key"
  ON "instagram_account_groups"("organization_id", lower("name"));

ALTER TABLE "instagram_accounts"
  ADD CONSTRAINT "instagram_accounts_organization_id_group_id_fkey"
  FOREIGN KEY ("organization_id", "group_id")
  REFERENCES "instagram_account_groups"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "instagram_accounts_organization_id_group_id_created_at_idx"
  ON "instagram_accounts"("organization_id", "group_id", "created_at");
CREATE INDEX "instagram_accounts_organization_id_tags_idx"
  ON "instagram_accounts" USING GIN ("tags");

CREATE TABLE "instagram_account_settings" (
  "organization_id" UUID NOT NULL,
  "max_active_accounts" INTEGER NOT NULL DEFAULT 10,
  "max_groups" INTEGER NOT NULL DEFAULT 20,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "instagram_account_settings_pkey" PRIMARY KEY ("organization_id"),
  CONSTRAINT "instagram_account_settings_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "instagram_account_settings_max_active_accounts_check"
    CHECK ("max_active_accounts" BETWEEN 1 AND 1000),
  CONSTRAINT "instagram_account_settings_max_groups_check"
    CHECK ("max_groups" BETWEEN 1 AND 200)
);
INSERT INTO "instagram_account_settings" ("organization_id", "updated_at")
SELECT "id", CURRENT_TIMESTAMP FROM "organizations";

CREATE TABLE "instagram_account_access" (
  "organization_id" UUID NOT NULL,
  "instagram_account_id" UUID NOT NULL,
  "membership_id" UUID NOT NULL,
  "level" "InstagramAccountAccessLevel" NOT NULL DEFAULT 'VIEW',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "instagram_account_access_pkey"
    PRIMARY KEY ("organization_id", "instagram_account_id", "membership_id"),
  CONSTRAINT "instagram_account_access_account_fkey"
    FOREIGN KEY ("organization_id", "instagram_account_id")
    REFERENCES "instagram_accounts"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "instagram_account_access_membership_fkey"
    FOREIGN KEY ("organization_id", "membership_id")
    REFERENCES "memberships"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "instagram_account_access_organization_id_membership_id_level_idx"
  ON "instagram_account_access"("organization_id", "membership_id", "level");

CREATE TABLE "instagram_account_preferences" (
  "organization_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "instagram_account_id" UUID NOT NULL,
  "favorite" BOOLEAN NOT NULL DEFAULT false,
  "is_default" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "instagram_account_preferences_pkey"
    PRIMARY KEY ("organization_id", "user_id", "instagram_account_id"),
  CONSTRAINT "instagram_account_preferences_membership_fkey"
    FOREIGN KEY ("user_id", "organization_id")
    REFERENCES "memberships"("user_id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "instagram_account_preferences_account_fkey"
    FOREIGN KEY ("organization_id", "instagram_account_id")
    REFERENCES "instagram_accounts"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "instagram_account_preferences_organization_user_favorite_idx"
  ON "instagram_account_preferences"("organization_id", "user_id", "favorite");
CREATE UNIQUE INDEX "instagram_account_preferences_one_default_per_user_key"
  ON "instagram_account_preferences"("organization_id", "user_id") WHERE "is_default" = true;
