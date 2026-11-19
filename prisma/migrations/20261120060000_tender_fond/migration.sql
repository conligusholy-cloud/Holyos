-- Veřejnou nabídku může vyhlásit i fond aliance. Útočníkem je pak fond,
-- ne hráč — platí ze své pokladny a podíl dostane on.
ALTER TABLE "game_tenders" ADD COLUMN IF NOT EXISTS "fond_id" INTEGER;
ALTER TABLE "game_tenders" ALTER COLUMN "utocnik_id" DROP NOT NULL;
CREATE INDEX IF NOT EXISTS "game_tenders_fond_id_idx" ON "game_tenders"("fond_id");
-- Stejná pojistka jako u podílu: nabídka patří právě jednomu útočníkovi.
ALTER TABLE "game_tenders" DROP CONSTRAINT IF EXISTS "game_tenders_utocnik";
ALTER TABLE "game_tenders" ADD CONSTRAINT "game_tenders_utocnik"
  CHECK (("utocnik_id" IS NULL) <> ("fond_id" IS NULL));
