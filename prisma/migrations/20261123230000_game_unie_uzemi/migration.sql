-- Unie prádlomatů: území master partnera a operátorské licence.
-- Psáno jako IF NOT EXISTS, ať se dá pustit i na databázi, kde už část stojí.

CREATE TABLE IF NOT EXISTS "game_territories" (
  "id"             SERIAL       NOT NULL,
  "area_key"       VARCHAR(80)  NOT NULL,
  "master_id"      INTEGER      NOT NULL,
  "master_nick"    VARCHAR(24)  NOT NULL,
  "poplatek_pct"   INTEGER      NOT NULL DEFAULT 100,
  "nespokojenost"  INTEGER      NOT NULL DEFAULT 0,
  "zavazek"        INTEGER      NOT NULL DEFAULT 0,
  "zavazek_od"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "zavazek_start"  INTEGER      NOT NULL DEFAULT 0,
  "licence"        INTEGER      NOT NULL DEFAULT 0,
  "licence_do"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "servis_do"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "operator_cena"  INTEGER,
  "operator_podil" INTEGER      NOT NULL DEFAULT 60,
  "vyzyvatel_id"   INTEGER,
  "vyzyvatel_nick" VARCHAR(24),
  "vyzyvatel_cena" INTEGER,
  "vyzva_do"       TIMESTAMP(3),
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"     TIMESTAMP(3) NOT NULL,
  CONSTRAINT "game_territories_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "game_territories_area_key_key" ON "game_territories"("area_key");
CREATE INDEX IF NOT EXISTS "game_territories_master_id_idx" ON "game_territories"("master_id");
CREATE INDEX IF NOT EXISTS "game_territories_vyzyvatel_id_idx" ON "game_territories"("vyzyvatel_id");
CREATE INDEX IF NOT EXISTS "game_territories_vyzva_do_idx" ON "game_territories"("vyzva_do");

CREATE TABLE IF NOT EXISTS "game_operator_licences" (
  "id"         SERIAL       NOT NULL,
  "area_key"   VARCHAR(80)  NOT NULL,
  "player_id"  INTEGER      NOT NULL,
  "nick"       VARCHAR(24)  NOT NULL,
  "cena"       INTEGER      NOT NULL DEFAULT 0,
  "podil_pct"  INTEGER      NOT NULL DEFAULT 60,
  "od"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "do_kdy"     TIMESTAMP(3),
  "zrusena"    BOOLEAN      NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "game_operator_licences_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "game_operator_licences_area_key_player_id_key" ON "game_operator_licences"("area_key", "player_id");
CREATE INDEX IF NOT EXISTS "game_operator_licences_player_id_idx" ON "game_operator_licences"("player_id");
