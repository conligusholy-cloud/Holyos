-- Do geo_tip se nově vejdou obě varianty i se jménem služby, ne jen jedno město.
ALTER TABLE "game_players" ALTER COLUMN "geo_tip" TYPE VARCHAR(200);
UPDATE "game_players" SET "geo_at" = NULL WHERE "geo_at" IS NOT NULL;
