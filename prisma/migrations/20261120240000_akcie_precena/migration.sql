-- Cenou akcie nehýbe jen obchodování.
--
-- Dosud se cena pohnula jedině tím, že někdo akcie koupil nebo prodal. Fond
-- přitom mohl koupit podíl hluboko pod cenou a akcionářům tím zhodnotit, co
-- drží — a v grafu byla rovná čára, jako by se nestalo nic. Nově se cena
-- přeceňuje spolu s účetní hodnotou akcie: co fond vydělá na svých nákupech,
-- jde do ceny, a co prodělá nebo rozdá, taky.
--
-- Proti čemu se měří: účetní hodnota akcie při posledním nastavení ceny.
ALTER TABLE "game_aliance" ADD COLUMN IF NOT EXISTS "akcie_ucetni" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- Řada cen. Graf se kreslí odsud, protože obchody už nejsou jediné místo,
-- kde se cena mění.
CREATE TABLE IF NOT EXISTS "game_akcie_cena" (
  "id"         SERIAL PRIMARY KEY,
  "aliance_id" INTEGER NOT NULL,
  "cena"       INTEGER NOT NULL,
  "duvod"      VARCHAR(12) NOT NULL,
  "ucetni"     DOUBLE PRECISION NOT NULL DEFAULT 0,
  "kdy"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "game_akcie_cena_graf" ON "game_akcie_cena"("aliance_id", "kdy");

-- Dosavadní graf se neztratí: každý uzavřený obchod byl zároveň cenou.
INSERT INTO "game_akcie_cena" ("aliance_id", "cena", "duvod", "ucetni", "kdy")
SELECT o."aliance_id", o."cena", 'obchod', 0, o."kdy"
  FROM "game_akcie_obchod" o
 WHERE NOT EXISTS (SELECT 1 FROM "game_akcie_cena" c WHERE c."aliance_id" = o."aliance_id");
