-- Kolik lidí v okrese žije. Licence za území se dosud počítala jen z volných
-- míst, která hráči prozkoumali — okres tím pádem stál stejně jako jedno
-- město, i když je v něm měst víc. Počet obyvatel je číslo, které platí i pro
-- tu část okresu, kam ještě nikdo nezašel.
ALTER TABLE "game_okresy" ADD COLUMN "obyvatel" INTEGER;
