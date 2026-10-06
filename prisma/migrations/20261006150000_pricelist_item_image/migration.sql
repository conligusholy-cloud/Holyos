-- Obrázek položky prodejního ceníku
ALTER TABLE "sales_pricelist_items" ADD COLUMN IF NOT EXISTS "image_ext" VARCHAR(10);
ALTER TABLE "sales_pricelist_items" ADD COLUMN IF NOT EXISTS "image_updated_at" TIMESTAMP(3);
