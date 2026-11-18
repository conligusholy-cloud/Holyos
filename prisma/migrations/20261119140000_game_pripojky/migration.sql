-- Přípojky: co hráč zaplatil za připojení stroje na místě.
--
-- Platí se při každé stavbě a je to největší výdaj, o kterém server nevěděl.
-- Bez něj vycházela čekaná změna hotovosti soustavně výš, než jak to
-- doopravdy chodí, a nedalo se z ní nic vyčíst.
--
-- Ukládají se dvě čísla. `pripojky` je to, co si hra naúčtovala; `pripojky_srv`
-- je horní odhad, který si server spočítá sám z otisku místa. Čtyři věci cenu
-- snižují a server o nich neví — pronajatá připravená plocha, předem
-- zaplacená příprava, vlastní četa a karta na řemeslníka — takže se hra smí
-- pohybovat pod jeho číslem. Co leží mimo rozumné pásmo, je vidět.
ALTER TABLE "game_spot_claims" ADD COLUMN IF NOT EXISTS "pripojky" INTEGER;
ALTER TABLE "game_spot_claims" ADD COLUMN IF NOT EXISTS "pripojky_srv" INTEGER;
