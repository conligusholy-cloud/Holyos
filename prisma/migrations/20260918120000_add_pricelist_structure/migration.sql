-- Ceník: strukturování na verzi (V2/V3/V4), variantu (S/G) a stroj
ALTER TABLE "sales_pricelist_items" ADD COLUMN "model_version" VARCHAR(8);
ALTER TABLE "sales_pricelist_items" ADD COLUMN "model_variant" VARCHAR(8);
ALTER TABLE "sales_pricelist_items" ADD COLUMN "machine_code" VARCHAR(60);

-- Index pro seskupené řazení podle verze a varianty
CREATE INDEX "sales_pricelist_items_model_version_model_variant_idx" ON "sales_pricelist_items"("model_version", "model_variant");
