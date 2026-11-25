-- Odkud je obrys okresu.
--
-- Mapa kreslila místo okresu město a z ničeho nešlo poznat proč: uložený obrys
-- vypadal stejně, ať přišel odkudkoli. Viník byla poslední záchrana, která
-- hledala hranici PODLE JMÉNA — na dotaz „Šumperk" odpoví katalog městem,
-- protože tak se to město jmenuje. Ta cesta je pryč; obrys smí přijít jedině
-- z objektu, který hledaný bod obsahuje.
--
-- Tenhle sloupec říká, který zdroj a jaká správní úroveň obrys dala. V
-- administraci je vidět u každého okresu.
ALTER TABLE "game_okresy" ADD COLUMN "zdroj" VARCHAR(60);

-- Obrysy stažené starou cestou se zahazují — mezi nimi jsou ta města. Stáhnou
-- se znovu, a co nedorazí, nakreslí mapa zatím jako kruh.
UPDATE "game_okresy" SET "hranice" = NULL, "sousedi" = NULL;
