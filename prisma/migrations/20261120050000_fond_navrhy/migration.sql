-- Návrh ve fondu aliance a hlasy k němu. O penězích fondu nerozhoduje
-- jeden člověk: váha hlasu je podíl na vkladech a mlčení je ne.
CREATE TABLE IF NOT EXISTS "game_fond_navrh" (
  "id"         SERIAL PRIMARY KEY,
  "aliance_id" INTEGER NOT NULL,
  "autor_id"   INTEGER NOT NULL,
  "druh"       VARCHAR(12) NOT NULL,
  "detail"     JSONB,
  "prah"       DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  "stav"       VARCHAR(12) NOT NULL DEFAULT 'bezi',
  "vysledek"   JSONB,
  "do"         TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "game_fond_navrh_aliance_id_stav_idx"
  ON "game_fond_navrh"("aliance_id", "stav");

CREATE TABLE IF NOT EXISTS "game_fond_hlas" (
  "id"         SERIAL PRIMARY KEY,
  "navrh_id"   INTEGER NOT NULL,
  "clen_id"    INTEGER NOT NULL,
  "volba"      VARCHAR(6) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "game_fond_hlas_navrh_id_clen_id_key"
  ON "game_fond_hlas"("navrh_id", "clen_id");
