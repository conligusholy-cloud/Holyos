-- Laundromats Milionář — burza mezi hráči
CREATE TABLE IF NOT EXISTS "game_trades" (
  "id" SERIAL NOT NULL,
  "from_id" INTEGER NOT NULL,
  "from_nick" VARCHAR(24) NOT NULL,
  "to_id" INTEGER NOT NULL,
  "to_nick" VARCHAR(24) NOT NULL,
  "smer" VARCHAR(8) NOT NULL,
  "predmet" VARCHAR(12) NOT NULL,
  "model" VARCHAR(10),
  "spot_id" VARCHAR(120),
  "card_kind" VARCHAR(24),
  "cena" INTEGER NOT NULL DEFAULT 0,
  "karty" JSONB,
  "vzkaz" VARCHAR(200),
  "stav" VARCHAR(12) NOT NULL DEFAULT 'ceka',
  "parent_id" INTEGER,
  "resolved_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "game_trades_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "game_trades_to_id_stav_idx" ON "game_trades"("to_id", "stav");
CREATE INDEX IF NOT EXISTS "game_trades_from_id_stav_idx" ON "game_trades"("from_id", "stav");

CREATE TABLE IF NOT EXISTS "game_deliveries" (
  "id" SERIAL NOT NULL,
  "player_id" INTEGER NOT NULL,
  "trade_id" INTEGER,
  "kind" VARCHAR(12) NOT NULL,
  "model" VARCHAR(10),
  "amount" INTEGER,
  "spot_id" VARCHAR(120),
  "data" JSONB,
  "popis" VARCHAR(200),
  "claimed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "game_deliveries_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "game_deliveries_player_id_claimed_at_idx" ON "game_deliveries"("player_id", "claimed_at");
