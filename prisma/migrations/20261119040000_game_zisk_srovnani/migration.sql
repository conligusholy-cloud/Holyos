-- Zisk podle hry a podle serveru, vedle sebe.
--
-- Server už umí spočítat, kolik síti měsíčně zbude: zná modely strojů,
-- skóre míst, nájmy i návštěvnost. Než se podle toho začne cokoli rozhodovat,
-- musí být vidět, jak daleko od sebe obě čísla jsou — a to na skutečném
-- provozu, ne na mém odhadu.
--
-- Zapisuje se k otisku hry, tedy nanejvýš jednou za deset minut na hráče.
-- Obě čísla jsou JEN za prádlomaty: pobočky, četa a úvěry se do nich
-- nepočítají ani na jedné straně, jinak by se porovnávaly různé věci.
ALTER TABLE "game_snapshots" ADD COLUMN IF NOT EXISTS "zisk_hra" DOUBLE PRECISION;
ALTER TABLE "game_snapshots" ADD COLUMN IF NOT EXISTS "zisk_server" DOUBLE PRECISION;
-- Kolik prádlomatů z toho server umí ocenit přesně. Bez toho by se nedalo
-- poznat, jestli rozdíl dělá chyba, nebo chybějící skóre.
ALTER TABLE "game_snapshots" ADD COLUMN IF NOT EXISTS "zisk_presne" INTEGER;
