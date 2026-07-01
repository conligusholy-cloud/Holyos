-- Požadavek #85 — díl může patřit do více eshop kategorií současně (M:N).
-- Nahrazuje jednočetnou FK materials.eshop_category_id implicitní M:N relací
-- "MaterialEshopCategories" mezi Material a EshopCategory.
--
-- POZN. (req #88): Migrace je záměrně IDEMPOTENTNÍ. Na Railway byl sloupec
-- materials.eshop_category_id dropnut ručně dřív, než se stihla nasadit tato
-- migrace. Krok 2 (přenos dat) je proto chráněn kontrolou existence sloupce,
-- aby `prisma migrate deploy` nespadl, když sloupec už neexistuje.

-- 1) Join tabulka dle Prisma konvence pro implicitní M:N relaci "MaterialEshopCategories".
--    Sloupce A/B jsou řazeny abecedně dle názvu modelu: A = EshopCategory, B = Material.
CREATE TABLE IF NOT EXISTS "_MaterialEshopCategories" (
    "A" INTEGER NOT NULL,
    "B" INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "_MaterialEshopCategories_AB_unique" ON "_MaterialEshopCategories"("A", "B");
CREATE INDEX IF NOT EXISTS "_MaterialEshopCategories_B_index" ON "_MaterialEshopCategories"("B");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '_MaterialEshopCategories_A_fkey') THEN
    ALTER TABLE "_MaterialEshopCategories" ADD CONSTRAINT "_MaterialEshopCategories_A_fkey"
      FOREIGN KEY ("A") REFERENCES "eshop_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '_MaterialEshopCategories_B_fkey') THEN
    ALTER TABLE "_MaterialEshopCategories" ADD CONSTRAINT "_MaterialEshopCategories_B_fkey"
      FOREIGN KEY ("B") REFERENCES "materials"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- 2) Přenést existující jednočetná přiřazení do M:N tabulky (zachovat data).
--    Jen pokud sloupec eshop_category_id ještě existuje (na Railway už mohl být
--    dropnut ručně — viz req #88), jinak by INSERT ... SELECT spadl.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'materials' AND column_name = 'eshop_category_id'
  ) THEN
    INSERT INTO "_MaterialEshopCategories" ("A", "B")
    SELECT "eshop_category_id", "id"
    FROM "materials"
    WHERE "eshop_category_id" IS NOT NULL
    ON CONFLICT ("A", "B") DO NOTHING;
  END IF;
END $$;

-- 3) Zrušit starou jednočetnou FK, index a sloupec.
ALTER TABLE "materials" DROP CONSTRAINT IF EXISTS "materials_eshop_category_id_fkey";
DROP INDEX IF EXISTS "materials_eshop_category_id_idx";
ALTER TABLE "materials" DROP COLUMN IF EXISTS "eshop_category_id";
