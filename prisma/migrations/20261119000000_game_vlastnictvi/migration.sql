-- Kdo kdy přišel o kus firmy a proč.
--
-- Podíly se mění na deseti místech: prodej, odkup, převod na třetího,
-- kapitálový vstup, konverze půjčky, propadlá zástava, veřejná nabídka,
-- dražba. Po každé změně zůstal v databázi jen nový stav. Když se hráč
-- zeptal, kam se poděla pětina jeho firmy, nebylo co otevřít.
--
-- Řádka = jeden člověk, jedna firma, jedna změna: z kolika na kolik a proč.
-- Zapisuje se uvnitř téže transakce jako sám převod — audit, který může
-- chybět, není audit.
CREATE TABLE IF NOT EXISTS "game_vlastnictvi" (
  "id"             SERIAL PRIMARY KEY,
  "firma_id"       INTEGER NOT NULL,
  "investor_id"    INTEGER NOT NULL,
  "podil_pred"     DOUBLE PRECISION NOT NULL,
  "podil_po"       DOUBLE PRECISION NOT NULL,
  -- prodej | odkup | prevod | vstup | konverze | zastava | prevzeti | drazba
  "duvod"          VARCHAR(16) NOT NULL,
  "trade_id"       INTEGER,
  "protistrana_id" INTEGER,
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Hledá se dvojím způsobem: co se dělo s mou firmou a co se dělo s mým
-- podílem. Obojí nejnovější napřed.
CREATE INDEX IF NOT EXISTS "game_vlastnictvi_firma_idx"
  ON "game_vlastnictvi" ("firma_id", "created_at");
CREATE INDEX IF NOT EXISTS "game_vlastnictvi_investor_idx"
  ON "game_vlastnictvi" ("investor_id", "created_at");
