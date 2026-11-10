-- Odkud hráč přišel (utm_source, fbclid, …), když ho nikdo nepozval.
ALTER TABLE "game_players" ADD COLUMN IF NOT EXISTS "zdroj" VARCHAR(80);
