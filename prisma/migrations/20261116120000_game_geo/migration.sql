-- Odkud se hráč připojuje: město a země z IP, bez ptaní.
ALTER TABLE "game_players" ADD COLUMN IF NOT EXISTS "geo_city"    VARCHAR(80);
ALTER TABLE "game_players" ADD COLUMN IF NOT EXISTS "geo_region"  VARCHAR(80);
ALTER TABLE "game_players" ADD COLUMN IF NOT EXISTS "geo_country" VARCHAR(80);
ALTER TABLE "game_players" ADD COLUMN IF NOT EXISTS "geo_cc"      VARCHAR(4);
ALTER TABLE "game_players" ADD COLUMN IF NOT EXISTS "geo_ip"      VARCHAR(64);
ALTER TABLE "game_players" ADD COLUMN IF NOT EXISTS "geo_at"      TIMESTAMP(3);
