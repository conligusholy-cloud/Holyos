-- Dražby na tržišti: minutový odpočet, každý příhoz přidá tři vteřiny.
CREATE TABLE IF NOT EXISTS "game_drazby" (
  "id"               SERIAL PRIMARY KEY,
  "prodavajici_id"   INTEGER NOT NULL,
  "prodavajici_nick" VARCHAR(24) NOT NULL,
  "predmet"          VARCHAR(12) NOT NULL,
  "model"            VARCHAR(10),
  "spot_id"          VARCHAR(120),
  "card_kind"        VARCHAR(24),
  "data"             JSONB,
  "nazev"            VARCHAR(160) NOT NULL,
  "vyvolavaci"       INTEGER NOT NULL,
  "suma"             INTEGER NOT NULL DEFAULT 0,
  "prihozu"          INTEGER NOT NULL DEFAULT 0,
  "vedouci_id"       INTEGER,
  "vedouci_nick"     VARCHAR(24),
  "konec"            TIMESTAMP(3) NOT NULL,
  "stav"             VARCHAR(12) NOT NULL DEFAULT 'bezi',
  "vitez_id"         INTEGER,
  "vitez_nick"       VARCHAR(24),
  "cena"             INTEGER,
  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "game_drazby_stav_konec_idx" ON "game_drazby" ("stav", "konec");

CREATE TABLE IF NOT EXISTS "game_drazba_prihozy" (
  "id"         SERIAL PRIMARY KEY,
  "drazba_id"  INTEGER NOT NULL,
  "player_id"  INTEGER NOT NULL,
  "nick"       VARCHAR(24) NOT NULL,
  "castka"     INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "game_drazba_prihozy_drazba_id_idx" ON "game_drazba_prihozy" ("drazba_id");
CREATE INDEX IF NOT EXISTS "game_drazba_prihozy_drazba_id_player_id_idx" ON "game_drazba_prihozy" ("drazba_id", "player_id");
