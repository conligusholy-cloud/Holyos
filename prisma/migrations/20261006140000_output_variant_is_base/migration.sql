ALTER TABLE "product_output_variants" ADD COLUMN IF NOT EXISTS "is_base" BOOLEAN NOT NULL DEFAULT false;
