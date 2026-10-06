-- Varianty operací pracovního postupu + volba varianty u výrobní dávky
ALTER TABLE "product_operations" ADD COLUMN IF NOT EXISTS "variant_of_id" INTEGER;
ALTER TABLE "product_operations" ADD COLUMN IF NOT EXISTS "variant_name" VARCHAR(120);
ALTER TABLE "product_operations" ADD COLUMN IF NOT EXISTS "variant_code" VARCHAR(20);
DO $$ BEGIN
  ALTER TABLE "product_operations" ADD CONSTRAINT "product_operations_variant_of_id_fkey" FOREIGN KEY ("variant_of_id") REFERENCES "product_operations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "product_operations_variant_of_id_idx" ON "product_operations"("variant_of_id");
ALTER TABLE "production_batches" ADD COLUMN IF NOT EXISTS "variant_choices" JSONB;
ALTER TABLE "production_batches" ADD COLUMN IF NOT EXISTS "variant_label" VARCHAR(255);
CREATE UNIQUE INDEX IF NOT EXISTS "product_operations_variant_code_key" ON "product_operations"(upper("variant_code")) WHERE "variant_code" IS NOT NULL;
