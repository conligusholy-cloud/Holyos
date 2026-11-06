-- Zasíťovaná místa: kde už někdy stál prádlomat, zůstávají přípojky.
CREATE TABLE IF NOT EXISTS "game_spots_built" (
  "spot_id"  VARCHAR(120) PRIMARY KEY,
  "area_key" VARCHAR(80)  NOT NULL,
  "first_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "game_spots_built_area_key_idx" ON "game_spots_built" ("area_key");

-- Co dnes stojí, je zasíťované už teď.
INSERT INTO "game_spots_built" ("spot_id", "area_key")
SELECT "spot_id", "area_key" FROM "game_spot_claims"
ON CONFLICT ("spot_id") DO NOTHING;
