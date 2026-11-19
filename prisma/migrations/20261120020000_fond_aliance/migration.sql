-- Aliance jako fond: členové do něj skládají peníze a podle vložené částky
-- z něj mají díl. Pokladna je hotovost, kterou fond opravdu drží; vklady
-- říkají, komu z ní kolik patří.
ALTER TABLE "game_aliance" ADD COLUMN IF NOT EXISTS "pokladna" DOUBLE PRECISION NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS "game_fond_vklad" (
  "id"         SERIAL PRIMARY KEY,
  "aliance_id" INTEGER NOT NULL,
  "clen_id"    INTEGER NOT NULL,
  "castka"     DOUBLE PRECISION NOT NULL DEFAULT 0,
  "vlozeno"    DOUBLE PRECISION NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "game_fond_vklad_aliance_id_clen_id_key"
  ON "game_fond_vklad"("aliance_id", "clen_id");
CREATE INDEX IF NOT EXISTS "game_fond_vklad_clen_id_idx" ON "game_fond_vklad"("clen_id");
