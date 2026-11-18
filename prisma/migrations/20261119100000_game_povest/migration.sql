-- Pověst počítaná serverem.
--
-- Poslední vstup návštěvnosti, který server bral od klienta. Násobí tržbu
-- celé sítě v rozsahu 0,8 až 1,1, takže kdo si ji nastaví na sto, přilepší
-- si o třetinu proti tomu, kdo ji má na dně.
--
-- Scénáře infolinky i váhy odpovědí server dávno má, takže mu stačí vědět,
-- co hráč vybral — váhu si najde sám. Tyhle sloupce drží výsledek a k tomu
-- denní strop ztráty za nepřítomnost a čas posledního hovoru, podle kterého
-- se pozná, že hovorů nemohlo proběhnout víc, než kolik se jich vejde do
-- uplynulého času.
--
-- NULL znamená „ještě se nepočítalo" — do té doby platí číslo ze stavu hry.
ALTER TABLE "game_players" ADD COLUMN IF NOT EXISTS "povest" DOUBLE PRECISION;
ALTER TABLE "game_players" ADD COLUMN IF NOT EXISTS "povest_den" VARCHAR(10);
ALTER TABLE "game_players" ADD COLUMN IF NOT EXISTS "povest_off" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "game_players" ADD COLUMN IF NOT EXISTS "povest_at" TIMESTAMP(3);
