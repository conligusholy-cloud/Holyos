-- Konkurzní rozprodej na Burze.
CREATE TABLE IF NOT EXISTS "game_auctions" (
  "id"         SERIAL       PRIMARY KEY,
  "player_id"  INTEGER      NOT NULL,
  "nick"       VARCHAR(24)  NOT NULL,
  "predmet"    VARCHAR(12)  NOT NULL,
  "model"      VARCHAR(10),
  "spot_id"    VARCHAR(120),
  "card_kind"  VARCHAR(24),
  "popis"      VARCHAR(160) NOT NULL,
  "hodnota"    INTEGER      NOT NULL,
  "data"       JSONB,
  "od"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "do"         TIMESTAMP(3) NOT NULL,
  "koupil_id"  INTEGER,
  "koupil_za"  INTEGER,
  "koupeno_at" TIMESTAMP(3)
);
CREATE INDEX IF NOT EXISTS "game_auctions_koupil_id_idx" ON "game_auctions" ("koupil_id");
CREATE INDEX IF NOT EXISTS "game_auctions_do_idx" ON "game_auctions" ("do");
