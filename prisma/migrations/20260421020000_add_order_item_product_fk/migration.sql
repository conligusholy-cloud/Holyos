-- Přidání FK constraint order_items.product_id -> products.id.
-- Sloupec product_id už existuje (z ranějších migrací), ale neměl FK constraint
-- ani Prisma relaci, takže include: { product: ... } házel 500.

-- Krok 1: bezpečně vynulovat reference, které ukazují na neexistující produkty.
-- (Nezbytné, jinak by ADD CONSTRAINT selhalo.)
UPDATE "order_items"
SET "product_id" = NULL
WHERE "product_id" IS NOT NULL
  AND "product_id" NOT IN (SELECT "id" FROM "products");

-- Krok 2: přidat FK constraint s ON DELETE SET NULL.
-- Index na product_id už existuje z init migrace.
ALTER TABLE "order_items"
  ADD CONSTRAINT "order_items_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "products"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
