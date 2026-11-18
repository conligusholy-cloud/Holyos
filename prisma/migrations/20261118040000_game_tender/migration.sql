-- Veřejná nabídka na odkup podílů.
-- Dosud se podíl dal koupit jen od jednoho hráče a po dohodě. Kdo chtěl
-- ovládnout firmu, ve které drží podíl pět lidí, musel pětkrát vyjednávat
-- a každý z nich věděl, že ostatní už prodali — kdo prodal poslední, řekl
-- si o cokoli.
--
-- Nabídka míří na všechny podílníky najednou: jedna cena za procento, jedna
-- lhůta, každý se rozhoduje sám za sebe. Prodat musí chtít; mlčení je
-- odmítnutí. Převede se jen to, co kdo doopravdy prodal.
CREATE TABLE IF NOT EXISTS "game_tenders" (
  "id"           SERIAL PRIMARY KEY,
  "utocnik_id"   INTEGER NOT NULL,
  "utocnik_nick" VARCHAR(24) NOT NULL,
  "firma_id"     INTEGER NOT NULL,
  "firma_nick"   VARCHAR(24) NOT NULL,
  -- Kolik platí za jedno procento firmy.
  "cena_za_pct"  INTEGER NOT NULL,
  -- Kolik procent nejvíc chce koupit a kolik už koupil.
  "max_pct"      DOUBLE PRECISION NOT NULL,
  "koupeno_pct"  DOUBLE PRECISION NOT NULL DEFAULT 0,
  "do"           TIMESTAMP(3) NOT NULL,
  -- bezi | naplnena | dobehla | zrusena
  "stav"         VARCHAR(12) NOT NULL DEFAULT 'bezi',
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "game_tenders_firma_id_stav_idx" ON "game_tenders"("firma_id", "stav");
CREATE INDEX IF NOT EXISTS "game_tenders_utocnik_id_idx" ON "game_tenders"("utocnik_id");
