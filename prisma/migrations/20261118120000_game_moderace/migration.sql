-- AI hlídání textů hráčů (vzkazy u obchodů, nick, název firmy)
CREATE TABLE IF NOT EXISTS "game_moderace" (
  "id" SERIAL PRIMARY KEY,
  "player_id" INTEGER NOT NULL,
  "zdroj" VARCHAR(12) NOT NULL,
  "ref_id" INTEGER,
  "komu" VARCHAR(60),
  "text" VARCHAR(800) NOT NULL,
  "verdikt" VARCHAR(12) NOT NULL,
  "cil" VARCHAR(120),
  "duvod" VARCHAR(300),
  "resolved_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "game_moderace_player_id_created_at_idx" ON "game_moderace"("player_id", "created_at");
CREATE INDEX IF NOT EXISTS "game_moderace_verdikt_resolved_at_idx" ON "game_moderace"("verdikt", "resolved_at");
