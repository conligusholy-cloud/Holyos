-- Splněný sen něco stojí i dál: servis, pojištění, palivo, garáž, pilot.
-- A když to hráče přeroste, může ho prodat — se ztrátou.
ALTER TABLE "game_dreams" ADD COLUMN IF NOT EXISTS "rezie" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "game_dreams" ADD COLUMN IF NOT EXISTS "prodano_at" TIMESTAMP(3);
ALTER TABLE "game_dreams" ADD COLUMN IF NOT EXISTS "prodano_za" INTEGER;
CREATE INDEX IF NOT EXISTS "game_dreams_splneno_at_idx" ON "game_dreams"("splneno_at");
