-- Výstupní nabídka: trvalý odkup zbytku od podílníka nad 75 %.
--
-- Menšina ve firmě, kterou ovládá někdo jiný, dosud neměla jak ven. Prodat
-- šlo jen tomu, kdo zrovna sám nabídl — a kdo nenabídl, držel podíl, na
-- jehož výplatu už neměl vliv.
--
-- Výstupní nabídka to otáčí: kdo firmu ovládá, nabídne cenu a nechá ji
-- viset. Nemá lhůtu, takže kdo byl tři týdny pryč, může ji vzít, až se
-- vrátí — a kdo nechce prodat, neprodá. Nucený odkup to vědomě není.
--
-- Proto je "do" nově prázdné: trvalá nabídka žádný konec nemá a datum
-- napsané sto let dopředu by byla lež v databázi.
ALTER TABLE "game_tenders" ALTER COLUMN "do" DROP NOT NULL;
ALTER TABLE "game_tenders"
  ADD COLUMN IF NOT EXISTS "trvala" BOOLEAN NOT NULL DEFAULT false;
