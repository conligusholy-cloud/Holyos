-- Market place: na tržišti smí viset i samotné místo, ne jen hotová provozovna.
--
-- Dosud se prodávalo jen místo, na kterém už stál prádlomat. Kdo připravil
-- plochu a natáhl přípojky, neměl ji jak prodat — šlo ji jenom pronajmout.
-- Tím pádem neexistovala cesta, jak hráči nabídnout místo k postavení,
-- a nováček musel hledat na mapě sám.
--
-- druh říká, co se nabízí; rozpis ceny je kvůli tomu, aby kupující viděl,
-- z čeho se ta jedna částka skládá; pobocka je doklad, že prodávající umí
-- v té lokalitě servisovat.
ALTER TABLE "game_market" ADD COLUMN "druh" VARCHAR(16) NOT NULL DEFAULT 'provozovna';
ALTER TABLE "game_market" ADD COLUMN "model_pro" VARCHAR(10);
ALTER TABLE "game_market" ADD COLUMN "cena_misto" INTEGER;
ALTER TABLE "game_market" ADD COLUMN "cena_pripojky" INTEGER;
ALTER TABLE "game_market" ADD COLUMN "pobocka" VARCHAR(80);
