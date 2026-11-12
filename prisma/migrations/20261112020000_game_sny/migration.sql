-- Nástěnka snů. Hráč si napíše, co by jednou chtěl, AI k tomu odhadne cenu
-- a nakreslí obrázek — a až na to ve hře vydělá, koupí si to za laundry.
CREATE TABLE IF NOT EXISTS "game_dreams" (
  "id"         SERIAL PRIMARY KEY,
  "player_id"  INTEGER NOT NULL,
  "nazev"      VARCHAR(80) NOT NULL,
  "popis"      VARCHAR(300),
  "zadani"     VARCHAR(200),
  "cena"       INTEGER NOT NULL,
  "obrazek"    TEXT,
  "foto"       TEXT,
  "splneno_at" TIMESTAMP(3),
  "zaplaceno"  INTEGER,
  "poradi"     INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "game_dreams_player_id_idx" ON "game_dreams"("player_id");
