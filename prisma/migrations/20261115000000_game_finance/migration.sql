-- Půjčky mezi hráči a podíly ve firmách.
ALTER TABLE "game_trades" ADD COLUMN IF NOT EXISTS "data" JSONB;

CREATE TABLE IF NOT EXISTS "game_loans" (
  "id"            SERIAL PRIMARY KEY,
  "trade_id"      INTEGER,
  "lender_id"     INTEGER NOT NULL,
  "lender_nick"   VARCHAR(24) NOT NULL,
  "borrower_id"   INTEGER NOT NULL,
  "borrower_nick" VARCHAR(24) NOT NULL,
  "castka"        INTEGER NOT NULL,
  "urok"          DOUBLE PRECISION NOT NULL DEFAULT 0,
  "mesicu"        INTEGER NOT NULL,
  "splatka"       INTEGER NOT NULL,
  "splaceno"      INTEGER NOT NULL DEFAULT 0,
  "zmeskano"      INTEGER NOT NULL DEFAULT 0,
  "zastava_spot"  VARCHAR(120),
  "zastava_nazev" VARCHAR(160),
  "stav"          VARCHAR(12) NOT NULL DEFAULT 'bezi',
  "dalsi_at"      TIMESTAMP(3) NOT NULL,
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "game_loans_stav_dalsi_at_idx" ON "game_loans" ("stav", "dalsi_at");
CREATE INDEX IF NOT EXISTS "game_loans_borrower_id_idx" ON "game_loans" ("borrower_id");
CREATE INDEX IF NOT EXISTS "game_loans_lender_id_idx" ON "game_loans" ("lender_id");

CREATE TABLE IF NOT EXISTS "game_equity" (
  "id"            SERIAL PRIMARY KEY,
  "trade_id"      INTEGER,
  "investor_id"   INTEGER NOT NULL,
  "investor_nick" VARCHAR(24) NOT NULL,
  "firma_id"      INTEGER NOT NULL,
  "firma_nick"    VARCHAR(24) NOT NULL,
  "podil"         DOUBLE PRECISION NOT NULL,
  "cena"          INTEGER NOT NULL,
  "vyplaceno"     INTEGER NOT NULL DEFAULT 0,
  "stav"          VARCHAR(12) NOT NULL DEFAULT 'bezi',
  "dalsi_at"      TIMESTAMP(3) NOT NULL,
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "game_equity_stav_dalsi_at_idx" ON "game_equity" ("stav", "dalsi_at");
CREATE INDEX IF NOT EXISTS "game_equity_firma_id_idx" ON "game_equity" ("firma_id");
CREATE INDEX IF NOT EXISTS "game_equity_investor_id_idx" ON "game_equity" ("investor_id");
