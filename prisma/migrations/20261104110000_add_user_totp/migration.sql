-- Dvoufaktorové ověření (TOTP): šifrovaný secret, příznak zapnutí a hashe záložních kódů
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "totp_secret" VARCHAR(255);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "totp_enabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "totp_backup_codes" JSONB;
