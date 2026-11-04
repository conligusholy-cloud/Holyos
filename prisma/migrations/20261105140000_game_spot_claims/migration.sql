-- Laundromats Milionář — obsazená místa (jedno místo = jeden prádlomat)
CREATE TABLE IF NOT EXISTS "game_spot_claims" (
  "id" SERIAL NOT NULL,
  "spot_id" VARCHAR(120) NOT NULL,
  "area_key" VARCHAR(80) NOT NULL,
  "player_id" INTEGER NOT NULL,
  "nick" VARCHAR(24) NOT NULL,
  "model" VARCHAR(10) NOT NULL,
  "rent" INTEGER NOT NULL,
  "name" VARCHAR(160),
  "lat" DOUBLE PRECISION,
  "lon" DOUBLE PRECISION,
  "takeovers" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "game_spot_claims_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "game_spot_claims_spot_id_key" ON "game_spot_claims"("spot_id");
CREATE INDEX IF NOT EXISTS "game_spot_claims_area_key_idx" ON "game_spot_claims"("area_key");
CREATE INDEX IF NOT EXISTS "game_spot_claims_player_id_idx" ON "game_spot_claims"("player_id");
