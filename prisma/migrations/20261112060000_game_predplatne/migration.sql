-- Předplatné, které se strhává samo (vedoucí servisních techniků).
-- Pravda je ve Stripu, tahle tabulka je jeho odraz z webhooků.
CREATE TABLE IF NOT EXISTS "game_subscriptions" (
  "id"             SERIAL PRIMARY KEY,
  "player_id"      INTEGER NOT NULL,
  "kind"           VARCHAR(24) NOT NULL,
  "qty"            INTEGER NOT NULL DEFAULT 1,
  "status"         VARCHAR(16) NOT NULL DEFAULT 'pending',
  "stripe_sub"     VARCHAR(100),
  "stripe_session" VARCHAR(100),
  "stripe_cust"    VARCHAR(100),
  "obnovi_se"      BOOLEAN NOT NULL DEFAULT true,
  "plati_do"       TIMESTAMP(3),
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "game_subscriptions_player_id_fkey" FOREIGN KEY ("player_id")
    REFERENCES "game_players"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "game_subscriptions_stripe_sub_key" ON "game_subscriptions"("stripe_sub");
CREATE UNIQUE INDEX IF NOT EXISTS "game_subscriptions_stripe_session_key" ON "game_subscriptions"("stripe_session");
CREATE INDEX IF NOT EXISTS "game_subscriptions_player_id_idx" ON "game_subscriptions"("player_id");
CREATE INDEX IF NOT EXISTS "game_subscriptions_status_idx" ON "game_subscriptions"("status");
