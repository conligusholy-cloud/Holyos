-- Země prozkoumaného města. Z ní jsou vlaječky u hráčů v žebříčku.
ALTER TABLE "game_areas" ADD COLUMN IF NOT EXISTS "country" VARCHAR(2);
