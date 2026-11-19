-- Stínová pokladna: hotovost, jak ji vede server. Zatím nerozhoduje, jen se
-- posouvá o to, co si server sám spočítal, a stojí vedle čísla od hry.
-- Rozdíl se schválně sčítá — srovnává se jen ručně, až se příčina najde.
CREATE TABLE IF NOT EXISTS "game_pokladna" (
  "player_id"   INTEGER PRIMARY KEY,
  "hotovost"    DOUBLE PRECISION NOT NULL DEFAULT 0,
  "hra"         DOUBLE PRECISION NOT NULL DEFAULT 0,
  "stav"        JSONB,
  "kroku"       INTEGER NOT NULL DEFAULT 0,
  "zalozeno_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "srovnano_at" TIMESTAMP(3),
  "srovnano_o"  DOUBLE PRECISION NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS "game_pokladna_at_idx" ON "game_pokladna"("at");
