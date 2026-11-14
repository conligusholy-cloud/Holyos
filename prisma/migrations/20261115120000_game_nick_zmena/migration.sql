-- Kdy si hráč naposledy změnil jméno. Null = nikdy, mění se tedy hned.
ALTER TABLE "game_players" ADD COLUMN IF NOT EXISTS "nick_at" TIMESTAMP(3);
