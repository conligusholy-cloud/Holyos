-- Vzorky hodnoty fondu.
--
-- Hodnota fondu se nikam nezapisovala, takže graf neměl z čeho vzniknout.
-- Dopočítat ji zpětně nejde: pokladna se mění vklady, nákupy a výplatami a
-- cena podílu se hýbe sama s tím, jak roste firma, kterou fond drží. Historie
-- tedy začíná dnem, kdy se začala zapisovat.
CREATE TABLE "game_fond_historie" (
  "id" SERIAL PRIMARY KEY,
  "aliance_id" INTEGER NOT NULL,
  "kdy" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- Dvojnásobná přesnost schválně: hodnota fondu nemá strop a celé číslo
  -- by při miliardách přeteklo.
  "pokladna" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "podily" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "hodnota" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "clenu" INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX "game_fond_historie_aliance_id_kdy_idx"
  ON "game_fond_historie"("aliance_id", "kdy");
