-- Tržiště: hráč veřejně nabídne postavený prádlomat i s místem za svoji cenu.
-- Kdo ho koupí, dostane stroj, nájemní smlouvu i přípojky — a vydělává hned.
CREATE TABLE IF NOT EXISTS "game_market" (
  "id"          SERIAL PRIMARY KEY,
  "player_id"   INTEGER NOT NULL,
  "nick"        VARCHAR(24) NOT NULL,
  "firma"       VARCHAR(60),
  "spot_id"     VARCHAR(120) NOT NULL,
  "area_key"    VARCHAR(80),
  "name"        VARCHAR(160),
  "model"       VARCHAR(10) NOT NULL,
  "kind"        VARCHAR(40),
  "score"       INTEGER NOT NULL DEFAULT 60,
  "lat"         DOUBLE PRECISION,
  "lon"         DOUBLE PRECISION,
  "rent"        INTEGER NOT NULL DEFAULT 0,
  "zisk"        INTEGER NOT NULL DEFAULT 0,
  "obrat"       INTEGER NOT NULL DEFAULT 0,
  "investice"   INTEGER NOT NULL DEFAULT 0,
  "cena"        INTEGER NOT NULL DEFAULT 0,
  "plan"        JSONB,
  "od"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "do"          TIMESTAMP(3) NOT NULL,
  "koupil_id"   INTEGER,
  "koupil_nick" VARCHAR(24),
  "koupeno_at"  TIMESTAMP(3),
  "zruseno_at"  TIMESTAMP(3),
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "game_market_do_idx" ON "game_market"("do");
CREATE INDEX IF NOT EXISTS "game_market_player_id_idx" ON "game_market"("player_id");
CREATE INDEX IF NOT EXISTS "game_market_spot_id_idx" ON "game_market"("spot_id");
