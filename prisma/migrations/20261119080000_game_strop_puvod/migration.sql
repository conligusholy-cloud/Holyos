-- Odkud se vzal přírůstek hotovosti, který přetekl mez.
--
-- Dosud se u otisku ukládal jen skok a strop. Z toho se nedalo poznat, jestli
-- šlo o planý poplach — hráč si načerpal z úvěrového rámce nebo si vyzvedl
-- doručenku — nebo o peníze, které se nemají odkud vzít. V logu ta čísla
-- byla, ale log se po pár dnech protočí a přehled je nevidí.
--
-- Bez toho se mez nedá utáhnout: nejde říct, že tři dny nepřibyl nový
-- případ, když se u starých neví, co byly zač.
ALTER TABLE "game_snapshots" ADD COLUMN IF NOT EXISTS "pujceno" DOUBLE PRECISION;
ALTER TABLE "game_snapshots" ADD COLUMN IF NOT EXISTS "ze_serveru" DOUBLE PRECISION;
