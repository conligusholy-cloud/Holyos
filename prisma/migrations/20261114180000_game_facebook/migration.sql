-- Kdy si hráč vyzvedl dárek za sledování stránky na Facebooku (jednou za účet).
ALTER TABLE "game_players" ADD COLUMN IF NOT EXISTS "facebook_at" TIMESTAMP(3);
