-- Otisk hry v čase.
-- Ukládaný stav si drží jen poslední podobu, takže na otázku „kam se podělo
-- dvacet milionů" se dnes nedá odpovědět — historie neexistuje. Tahle tabulka
-- je nejlevnější historie, jaká dává smysl: pár čísel při ukládání, nanejvýš
-- jednou za deset minut na hráče, a vždycky když přírůstek hotovosti přeteče
-- mez, kterou si server spočítá sám.
--
-- Čísla jsou DOUBLE PRECISION, ne INTEGER: jmění velkého hráče přeroste dvě
-- miliardy a celočíselný sloupec by přetekl zrovna u toho, koho je potřeba
-- hlídat.
CREATE TABLE IF NOT EXISTS "game_snapshots" (
  "id"         SERIAL PRIMARY KEY,
  "player_id"  INTEGER NOT NULL,
  "hotovost"   DOUBLE PRECISION NOT NULL,
  "jmeni"      DOUBLE PRECISION,
  "pradlomatu" INTEGER NOT NULL DEFAULT 0,
  "prirustek"  DOUBLE PRECISION NOT NULL DEFAULT 0,
  "strop"      DOUBLE PRECISION,
  "sedi"       BOOLEAN NOT NULL DEFAULT true,
  "od_ms"      INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "game_snapshots_player_id_created_at_idx"
  ON "game_snapshots"("player_id", "created_at");
CREATE INDEX IF NOT EXISTS "game_snapshots_sedi_created_at_idx"
  ON "game_snapshots"("sedi", "created_at");
