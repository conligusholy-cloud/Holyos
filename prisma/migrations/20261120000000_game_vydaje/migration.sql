-- Výdaje, o kterých server ví, protože sám obsloužil požadavek, ale neměl je
-- kam zapsat: výměna stroje, poplatek za neúspěšné vyjednávání, odstupné při
-- výpovědi. Bez nich čekaná změna očekává víc hotovosti, než se stane, a dělá
-- tím místo, pod kterým se dá schovat hotovost navíc.
CREATE TABLE IF NOT EXISTS "game_vydaje" (
  "id"         SERIAL PRIMARY KEY,
  "player_id"  INTEGER NOT NULL,
  "druh"       VARCHAR(16) NOT NULL,
  "castka"     INTEGER NOT NULL,
  "spot_id"    VARCHAR(120),
  "detail"     JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "game_vydaje_player_id_created_at_idx" ON "game_vydaje"("player_id", "created_at");
