-- Laundromats Milionář — ručně přidaná hotovost nese vlastní částku
ALTER TABLE "game_cards" ADD COLUMN IF NOT EXISTS "amount" INTEGER;
