-- Distributorský program: měsíční režie a provize z prádlomatů pozvaných hráčů.
ALTER TABLE "game_players" ADD COLUMN IF NOT EXISTS "distributor_do" TIMESTAMP(3);
ALTER TABLE "game_players" ADD COLUMN IF NOT EXISTS "provize_celkem" INTEGER NOT NULL DEFAULT 0;
