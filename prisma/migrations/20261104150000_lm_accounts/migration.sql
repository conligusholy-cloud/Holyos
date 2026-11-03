-- Laundromats.eu — účty registrovaných uživatelů
CREATE TABLE IF NOT EXISTS "lm_accounts" (
    "id" SERIAL NOT NULL,
    "email" VARCHAR(160) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "phone" VARCHAR(40),
    "company" VARCHAR(160),
    "password_hash" VARCHAR(100) NOT NULL,
    "email_verified_at" TIMESTAMP(3),
    "verify_token_hash" VARCHAR(64),
    "reset_token_hash" VARCHAR(64),
    "reset_expires_at" TIMESTAMP(3),
    "token_version" INTEGER NOT NULL DEFAULT 0,
    "plan" VARCHAR(20) NOT NULL DEFAULT 'free',
    "disabled" BOOLEAN NOT NULL DEFAULT false,
    "compounder_lead_id" INTEGER,
    "last_login_at" TIMESTAMP(3),
    "login_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "lm_accounts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "lm_accounts_email_key" ON "lm_accounts"("email");
CREATE INDEX IF NOT EXISTS "lm_accounts_compounder_lead_id_idx" ON "lm_accounts"("compounder_lead_id");
CREATE INDEX IF NOT EXISTS "lm_accounts_verify_token_hash_idx" ON "lm_accounts"("verify_token_hash");
CREATE INDEX IF NOT EXISTS "lm_accounts_reset_token_hash_idx" ON "lm_accounts"("reset_token_hash");
