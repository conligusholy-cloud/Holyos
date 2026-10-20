-- Nákupní objednávka: termín, kdy musí být položka nejpozději ve výrobě (start montáže)
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "needed_by" DATE;
