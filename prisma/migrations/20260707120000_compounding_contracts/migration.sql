-- HolyOS — Evidence smluv k lokalitám (Compounding)
-- Idempotentní (IF NOT EXISTS) kvůli ručnímu apply proti Railway.

CREATE TABLE IF NOT EXISTS "compounding_contracts" (
  "id"               SERIAL PRIMARY KEY,
  "kiosk_code"       VARCHAR(40) NOT NULL,
  "kiosk_label"      VARCHAR(300),
  "type"             VARCHAR(20) NOT NULL,
  "status"           VARCHAR(20) NOT NULL DEFAULT 'koncept',
  "fields"           JSONB NOT NULL DEFAULT '{}',
  "share_token"      VARCHAR(64),
  "share_expires_at" TIMESTAMP(3),
  "filled_at"        TIMESTAMP(3),
  "signed_at"        TIMESTAMP(3),
  "created_by_id"    INTEGER,
  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "compounding_contracts_share_token_key" ON "compounding_contracts"("share_token");
CREATE INDEX IF NOT EXISTS "compounding_contracts_kiosk_code_idx" ON "compounding_contracts"("kiosk_code");
CREATE INDEX IF NOT EXISTS "compounding_contracts_status_idx" ON "compounding_contracts"("status");
