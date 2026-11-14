-- Kdy si hráč vyzvedl kartičky za sledování na Instagramu (jednou za účet).
ALTER TABLE "game_players" ADD COLUMN IF NOT EXISTS "instagram_at" TIMESTAMP(3);
