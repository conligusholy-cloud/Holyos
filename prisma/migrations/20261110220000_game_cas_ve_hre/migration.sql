-- Kolik času hráč ve hře skutečně stráví. Sčítá se na serveru při ukládání
-- stavu — přičte se jen mezera, kdy měl hráč hru otevřenou na popředí.
ALTER TABLE "game_players" ADD COLUMN IF NOT EXISTS "hra_s_celkem" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "game_players" ADD COLUMN IF NOT EXISTS "hra_s_den" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "game_players" ADD COLUMN IF NOT EXISTS "hra_den" VARCHAR(10);
ALTER TABLE "game_players" ADD COLUMN IF NOT EXISTS "hra_at" TIMESTAMP(3);
