-- Auditní zápis vlastnických změn počítal pořád s tím, že podíl drží hráč:
-- investor_id bylo NOT NULL. Jenže podíl může patřit i fondu aliance, a pak
-- je investor_id prázdné — zápis na to padal a s ním celá transakce. Prakticky
-- to znamenalo, že prodej do fondové nabídky skončil chybou databáze a
-- neprošel vůbec.
ALTER TABLE "game_vlastnictvi" ADD COLUMN IF NOT EXISTS "fond_id" INTEGER;
ALTER TABLE "game_vlastnictvi" ALTER COLUMN "investor_id" DROP NOT NULL;
CREATE INDEX IF NOT EXISTS "game_vlastnictvi_fond_id_idx" ON "game_vlastnictvi"("fond_id");
-- Táž pojistka, jakou má game_equity: záznam patří buď hráči, nebo fondu,
-- nikdy obojímu a nikdy ani jednomu. Dosavadní řádky mají investor_id
-- vyplněné a fond_id prázdné, takže podmínku splňují.
ALTER TABLE "game_vlastnictvi" DROP CONSTRAINT IF EXISTS "game_vlastnictvi_drzitel";
ALTER TABLE "game_vlastnictvi" ADD CONSTRAINT "game_vlastnictvi_drzitel"
  CHECK (("investor_id" IS NULL) <> ("fond_id" IS NULL));
