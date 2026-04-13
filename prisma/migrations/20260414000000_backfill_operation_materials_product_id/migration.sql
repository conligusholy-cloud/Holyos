-- Backfill: nastav product_id u existujících operation_materials
-- Propojí operation_materials s products přes material_id
UPDATE "operation_materials" om
SET "product_id" = p."id"
FROM "products" p
WHERE p."material_id" = om."material_id"
  AND om."product_id" IS NULL
  AND p."material_id" IS NOT NULL;
