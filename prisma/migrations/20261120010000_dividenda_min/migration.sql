-- Minimální dividenda: většina může firmě uložit, kolik měsíčně vyplatí
-- nejméně. Když na to firma nevydělá, nic se nikomu nebere — rozdíl se
-- zapíše podílníkovi jako nedoplatek a vyplatí se, jakmile firma vydělá.
ALTER TABLE "game_players" ADD COLUMN IF NOT EXISTS "dividenda_min" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "game_equity" ADD COLUMN IF NOT EXISTS "nedoplatek" DOUBLE PRECISION NOT NULL DEFAULT 0;
