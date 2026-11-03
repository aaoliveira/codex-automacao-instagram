-- CreateEnum
CREATE TYPE "InstagramAccountStatus" AS ENUM ('DISCONNECTED', 'CONNECTING', 'CONNECTED', 'ERROR');

-- CreateEnum
CREATE TYPE "InstagramProviderType" AS ENUM ('MOCK', 'META');

-- CreateTable
CREATE TABLE "instagram_accounts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "provider" "InstagramProviderType" NOT NULL,
    "external_account_id" VARCHAR(255),
    "username" VARCHAR(100),
    "name" VARCHAR(150),
    "avatar_url" TEXT,
    "status" "InstagramAccountStatus" NOT NULL DEFAULT 'CONNECTING',
    "encrypted_access_token" TEXT,
    "access_token_iv" VARCHAR(32),
    "access_token_tag" VARCHAR(32),
    "token_expires_at" TIMESTAMPTZ(3),
    "connected_at" TIMESTAMPTZ(3),
    "disconnected_at" TIMESTAMPTZ(3),
    "last_synced_at" TIMESTAMPTZ(3),
    "last_error" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "instagram_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "instagram_oauth_states" (
    "id" UUID NOT NULL,
    "state_hash" CHAR(64) NOT NULL,
    "user_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "instagram_oauth_states_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "instagram_accounts_organization_id_status_idx" ON "instagram_accounts"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "instagram_accounts_organization_id_provider_external_accoun_key" ON "instagram_accounts"("organization_id", "provider", "external_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "instagram_oauth_states_state_hash_key" ON "instagram_oauth_states"("state_hash");

-- CreateIndex
CREATE INDEX "instagram_oauth_states_organization_id_expires_at_idx" ON "instagram_oauth_states"("organization_id", "expires_at");

-- AddForeignKey
ALTER TABLE "instagram_accounts" ADD CONSTRAINT "instagram_accounts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instagram_oauth_states" ADD CONSTRAINT "instagram_oauth_states_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instagram_oauth_states" ADD CONSTRAINT "instagram_oauth_states_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instagram_oauth_states" ADD CONSTRAINT "instagram_oauth_states_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "instagram_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
