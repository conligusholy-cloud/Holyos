-- Laundromats Milionář — účty hráčů, karty a nákupy

CREATE TABLE IF NOT EXISTS "game_players" (
  "id" SERIAL NOT NULL,
  "nick" VARCHAR(24) NOT NULL,
  "nick_lower" VARCHAR(24) NOT NULL,
  "password_hash" VARCHAR(100) NOT NULL,
  "email" VARCHAR(160),
  "first_name" VARCHAR(60),
  "last_name" VARCHAR(60),
  "state" JSONB,
  "state_at" TIMESTAMP(3),
  "token_version" INTEGER NOT NULL DEFAULT 0,
  "disabled" BOOLEAN NOT NULL DEFAULT false,
  "last_login_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "game_players_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "game_players_nick_lower_key" ON "game_players"("nick_lower");
CREATE INDEX IF NOT EXISTS "game_players_email_idx" ON "game_players"("email");

CREATE TABLE IF NOT EXISTS "game_purchases" (
  "id" SERIAL NOT NULL,
  "player_id" INTEGER NOT NULL,
  "kind" VARCHAR(24) NOT NULL,
  "qty" INTEGER NOT NULL DEFAULT 1,
  "amount_cents" INTEGER NOT NULL,
  "currency" VARCHAR(3) NOT NULL DEFAULT 'czk',
  "status" VARCHAR(16) NOT NULL DEFAULT 'pending',
  "stripe_session" VARCHAR(100),
  "stripe_intent" VARCHAR(100),
  "email" VARCHAR(160),
  "paid_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "game_purchases_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "game_purchases_stripe_session_key" ON "game_purchases"("stripe_session");
CREATE INDEX IF NOT EXISTS "game_purchases_player_id_idx" ON "game_purchases"("player_id");

CREATE TABLE IF NOT EXISTS "game_cards" (
  "id" SERIAL NOT NULL,
  "player_id" INTEGER NOT NULL,
  "kind" VARCHAR(24) NOT NULL,
  "purchase_id" INTEGER,
  "used_at" TIMESTAMP(3),
  "used_on" VARCHAR(80),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "game_cards_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "game_cards_player_id_used_at_idx" ON "game_cards"("player_id", "used_at");

DO $$ BEGIN
  ALTER TABLE "game_purchases" ADD CONSTRAINT "game_purchases_player_id_fkey"
    FOREIGN KEY ("player_id") REFERENCES "game_players"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "game_cards" ADD CONSTRAINT "game_cards_player_id_fkey"
    FOREIGN KEY ("player_id") REFERENCES "game_players"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "game_cards" ADD CONSTRAINT "game_cards_purchase_id_fkey"
    FOREIGN KEY ("purchase_id") REFERENCES "game_purchases"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
