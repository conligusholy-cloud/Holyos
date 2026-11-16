-- Poskytovatel připojení a jistota určení města. Mobilní sítě ukazují bránu
-- operátora, ne skutečné město, tak je potřeba to umět odlišit.
ALTER TABLE "game_players" ADD COLUMN IF NOT EXISTS "geo_isp"      VARCHAR(120);
ALTER TABLE "game_players" ADD COLUMN IF NOT EXISTS "geo_tip"      VARCHAR(80);
ALTER TABLE "game_players" ADD COLUMN IF NOT EXISTS "geo_presnost" VARCHAR(10);
-- Co se nasbíralo jedním zdrojem, se musí zjistit znovu — tehdy se křížem
-- neověřovalo a město může být o dvě stě kilometrů vedle.
UPDATE "game_players" SET "geo_at" = NULL WHERE "geo_at" IS NOT NULL;
