-- Cena pozemku do evidence míst.
-- Server dosud o koupené zemi věděl jen to, že existuje. Kolik stála, žilo
-- jen v prohlížeči, takže serverové jmění vycházelo hráči, který si vzal úvěr
-- a koupil pozemky, záporné. Cenu si teď server spočítá sám z otisku místa
-- a skóre a uloží ji sem.
--
-- Staré pozemky zůstanou bez ceny a bere se u nich střed cenového pásma.
-- Dopočítat je zpětně nejde: skóre místa z doby nákupu nikde není.
ALTER TABLE "game_spot_claims" ADD COLUMN IF NOT EXISTS "cena" INTEGER;
