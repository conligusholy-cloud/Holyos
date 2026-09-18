-- Rozlišení stroj vs příslušenství + kategorie příslušenství
ALTER TABLE "sales_pricelist_items" ADD COLUMN "kind" VARCHAR(20) NOT NULL DEFAULT 'machine';
ALTER TABLE "sales_pricelist_items" ADD COLUMN "category" VARCHAR(80);

CREATE INDEX "sales_pricelist_items_kind_category_idx" ON "sales_pricelist_items"("kind", "category");
