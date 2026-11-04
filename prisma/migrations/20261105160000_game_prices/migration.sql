-- Laundromats Milionář — ceník karet a balíčků peněz (měnitelný z administrace)
CREATE TABLE IF NOT EXISTS "game_prices" (
  "id" SERIAL NOT NULL,
  "kind" VARCHAR(24) NOT NULL,
  "price" INTEGER NOT NULL,
  "laundry" INTEGER,
  "name" VARCHAR(80),
  "active" BOOLEAN NOT NULL DEFAULT true,
  "updated_by" VARCHAR(80),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "game_prices_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "game_prices_kind_key" ON "game_prices"("kind");
