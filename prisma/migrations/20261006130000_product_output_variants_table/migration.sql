-- Varianty konce postupu (vlastní sada hotových výrobků) + vazby z výstupů, výbavy a dávky
CREATE TABLE IF NOT EXISTS "product_output_variants" (
  "id" SERIAL NOT NULL,
  "product_id" INTEGER NOT NULL,
  "code" VARCHAR(20) NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "product_output_variants_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "product_output_variants_code_key" ON "product_output_variants"("code");
CREATE INDEX IF NOT EXISTS "product_output_variants_product_id_idx" ON "product_output_variants"("product_id");
DO $$ BEGIN
  ALTER TABLE "product_output_variants" ADD CONSTRAINT "product_output_variants_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "product_outputs" ADD COLUMN IF NOT EXISTS "output_variant_id" INTEGER;
CREATE INDEX IF NOT EXISTS "product_outputs_output_variant_id_idx" ON "product_outputs"("output_variant_id");
DO $$ BEGIN
  ALTER TABLE "product_outputs" ADD CONSTRAINT "product_outputs_output_variant_id_fkey" FOREIGN KEY ("output_variant_id") REFERENCES "product_output_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "product_equipments" ADD COLUMN IF NOT EXISTS "output_variant_id" INTEGER;
CREATE INDEX IF NOT EXISTS "product_equipments_output_variant_id_idx" ON "product_equipments"("output_variant_id");
DO $$ BEGIN
  ALTER TABLE "product_equipments" ADD CONSTRAINT "product_equipments_output_variant_id_fkey" FOREIGN KEY ("output_variant_id") REFERENCES "product_output_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "production_batches" ADD COLUMN IF NOT EXISTS "output_variant_id" INTEGER;
DO $$ BEGIN
  ALTER TABLE "production_batches" ADD CONSTRAINT "production_batches_output_variant_id_fkey" FOREIGN KEY ("output_variant_id") REFERENCES "product_output_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
