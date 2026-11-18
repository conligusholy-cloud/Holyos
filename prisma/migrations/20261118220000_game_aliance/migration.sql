-- Investiční aliance: podíly členů se v jedné firmě sčítají.
--
-- Prahy ve firmě (čtvrtina blokuje, půlka určuje výplatu, tři čtvrtiny smí
-- nabídnout odchod) jsou pro jednotlivce skoro nedosažitelné, a čím míň je
-- hráčů, tím víc. Aliance je způsob, jak na ně dosáhnout společně.
--
-- Členství je jen seznam lidí. Žádná společná pokladna tu není a být nemůže:
-- hotovost žije ve stavu hry v prohlížeči, takže peníze členů nejde držet.
CREATE TABLE IF NOT EXISTS "game_aliance" (
  "id"            SERIAL PRIMARY KEY,
  "nazev"         VARCHAR(24) NOT NULL,
  "zakladatel_id" INTEGER NOT NULL,
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Pozvánka a členství v jedné tabulce: stav říká, co z toho to je.
-- pozval_id drží, kdo koho přivedl — ať je u sporu vidět, jak se tam kdo vzal.
CREATE TABLE IF NOT EXISTS "game_aliance_clen" (
  "id"         SERIAL PRIMARY KEY,
  "aliance_id" INTEGER NOT NULL,
  "player_id"  INTEGER NOT NULL,
  -- pozvan | clen
  "stav"       VARCHAR(10) NOT NULL DEFAULT 'pozvan',
  "pozval_id"  INTEGER,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Dvakrát pozvat do téže aliance nejde.
CREATE UNIQUE INDEX IF NOT EXISTS "game_aliance_clen_aliance_player_key"
  ON "game_aliance_clen" ("aliance_id", "player_id");

-- Jeden hráč může být členem jen jedné aliance. Pozvánek může mít víc —
-- rozhodne se, až když některou přijme. Hlídá to databáze, ne kód: na
-- souběh dvou přijetí ve stejnou vteřinu by se v kódu snadno zapomnělo.
CREATE UNIQUE INDEX IF NOT EXISTS "game_aliance_clen_jedno_clenstvi"
  ON "game_aliance_clen" ("player_id") WHERE "stav" = 'clen';

CREATE INDEX IF NOT EXISTS "game_aliance_clen_player_idx"
  ON "game_aliance_clen" ("player_id", "stav");
