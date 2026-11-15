-- Světové události: povodně, festivaly, zdražení energií. Jedna pro celý svět.
CREATE TABLE IF NOT EXISTS "game_events" (
  "id"         SERIAL PRIMARY KEY,
  "typ"        VARCHAR(32) NOT NULL,
  "nazev"      VARCHAR(120) NOT NULL,
  "popis"      TEXT NOT NULL,
  "ikona"      VARCHAR(8) NOT NULL,
  "dobra"      BOOLEAN NOT NULL DEFAULT false,
  "uroven"     VARCHAR(8) NOT NULL,
  "zeme"       VARCHAR(2),
  "area_key"   VARCHAR(80),
  "zavaznost"  INTEGER NOT NULL DEFAULT 1,
  "dopad"      JSONB NOT NULL,
  "od"         TIMESTAMP(3) NOT NULL,
  "do"         TIMESTAMP(3) NOT NULL,
  "rucni"      BOOLEAN NOT NULL DEFAULT false,
  "autor"      VARCHAR(80),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "game_events_od_idx" ON "game_events"("od");
CREATE INDEX IF NOT EXISTS "game_events_do_idx" ON "game_events"("do");
