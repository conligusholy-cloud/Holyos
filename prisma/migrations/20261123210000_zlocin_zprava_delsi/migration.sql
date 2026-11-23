-- Zpráva v herních novinách musí říct, čím přesně se hráč provinil.
--
-- Šest set znaků stačilo na „podezření: provize z účelově založených účtů".
-- To ale není obvinění, proti kterému se dá bránit: hráč nevidí, za které
-- účty, kolik to dělá a co z toho je nové proti dřívějšímu rozsudku.
-- Rozšíření na 1200 znaků dá prostor vypsat skutky i s čísly.
ALTER TABLE "game_zlocin_zpravy" ALTER COLUMN "text" TYPE VARCHAR(1200);
