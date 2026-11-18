-- Čekaná změna hotovosti vedle té skutečné.
--
-- Strop je hrubá mez: říká, co ještě JDE, ne co SEDÍ. Na rozhodnutí, jestli
-- smí o hotovosti rozhodovat server, je to málo — hráč může mít celý den
-- v mezích a přitom si každou hodinu přidat dvě stě tisíc.
--
-- Tohle je druhý krok. Server spočítá, kolik hotovosti hráči od minulého
-- uložení MĚLO přibýt nebo ubýt: zisk sítě za ten čas, doručenky, nákupy
-- strojů, koupená zem, čerpání a splátky úvěru. Vedle toho stojí skutečná
-- změna. Nesedí-li to soustavně, není co stěhovat.
--
-- Co do toho zatím nevidí: přípojky, pobočky, četa, kampaně a karty z
-- ceníku. Čekaná změna proto vychází VÝŠ než skutečná a rozdíl sám o sobě
-- nic nedokazuje — smysl dává sledovat ten opačný směr.
ALTER TABLE "game_snapshots" ADD COLUMN IF NOT EXISTS "ocekavano" DOUBLE PRECISION;
ALTER TABLE "game_snapshots" ADD COLUMN IF NOT EXISTS "nakupy" DOUBLE PRECISION;
