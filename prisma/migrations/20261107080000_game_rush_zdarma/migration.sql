-- Expresní dovoz zdarma: jeden za každé dva herní měsíce.
ALTER TABLE "game_players" ADD COLUMN IF NOT EXISTS "rush_zdarma_at" TIMESTAMP(3);
