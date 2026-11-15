-- Nejvyšší dosažená hodnost hráče. Null = ještě se nepočítala.
ALTER TABLE "game_players" ADD COLUMN IF NOT EXISTS "hodnost" VARCHAR(20);

-- Vyplacené odměny za hodnosti a odznaky. Unikátní index je tu kvůli penězům:
-- bez něj by dvojí uložení hry ve stejnou chvíli vyplatilo tutéž odměnu dvakrát.
CREATE TABLE IF NOT EXISTS "game_odmeny" (
  "id"         SERIAL PRIMARY KEY,
  "player_id"  INTEGER NOT NULL,
  "druh"       VARCHAR(10) NOT NULL,
  "kod"        VARCHAR(24) NOT NULL,
  "cash"       INTEGER NOT NULL DEFAULT 0,
  "karta"      VARCHAR(24),
  "zpetne"     BOOLEAN NOT NULL DEFAULT false,
  "vyplaceno"  BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "game_odmeny_player_id_druh_kod_key"
  ON "game_odmeny" ("player_id", "druh", "kod");
CREATE INDEX IF NOT EXISTS "game_odmeny_player_id_vyplaceno_idx"
  ON "game_odmeny" ("player_id", "vyplaceno");
