-- Podíl ve firmě může nově patřit fondu aliance, ne jen hráči. Drží ho buď
-- investor_id, nebo fond_id — nikdy obojí a nikdy ani jedno.
ALTER TABLE "game_equity" ADD COLUMN IF NOT EXISTS "fond_id" INTEGER;
ALTER TABLE "game_equity" ALTER COLUMN "investor_id" DROP NOT NULL;
CREATE INDEX IF NOT EXISTS "game_equity_fond_id_idx" ON "game_equity"("fond_id");
-- Pojistka proti řádku, který nepatří nikomu nebo patří dvěma. Databáze je
-- poslední místo, kde se taková chyba dá zastavit.
ALTER TABLE "game_equity" DROP CONSTRAINT IF EXISTS "game_equity_drzitel";
ALTER TABLE "game_equity" ADD CONSTRAINT "game_equity_drzitel"
  CHECK (("investor_id" IS NULL) <> ("fond_id" IS NULL));
