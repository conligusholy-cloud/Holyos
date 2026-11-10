-- Záznam první minuty návštěvy: co hráč na stránce viděl a kam klikal.
-- Ukládá se po částech (jedna část = pár vteřin), ať se neztratí, když
-- návštěvník odejde dřív. Vyplňované texty se nenahrávají.
CREATE TABLE IF NOT EXISTS "game_replays" (
  "id"         SERIAL PRIMARY KEY,
  "sid"        VARCHAR(64) NOT NULL,
  "poradi"     INTEGER NOT NULL DEFAULT 0,
  "udalosti"   JSONB NOT NULL,
  "bajtu"      INTEGER NOT NULL DEFAULT 0,
  "ms"         INTEGER NOT NULL DEFAULT 0,
  "ua"         TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "game_replays_sid_poradi_key" ON "game_replays"("sid", "poradi");
CREATE INDEX IF NOT EXISTS "game_replays_created_at_idx" ON "game_replays"("created_at");

-- Id první návštěvy u hráče: podle něj se k účtu najde jeho první minuta.
ALTER TABLE "game_players" ADD COLUMN IF NOT EXISTS "sid" VARCHAR(64);
CREATE INDEX IF NOT EXISTS "game_players_sid_idx" ON "game_players"("sid");
