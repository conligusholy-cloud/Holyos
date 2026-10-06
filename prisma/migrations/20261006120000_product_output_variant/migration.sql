-- Výstupy postupu per provedení (varianta operace)
ALTER TABLE "product_outputs" ADD COLUMN IF NOT EXISTS "variant_id" INTEGER;
DO $$ BEGIN
  ALTER TABLE "product_outputs" ADD CONSTRAINT "product_outputs_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_operations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "product_outputs_variant_id_idx" ON "product_outputs"("variant_id");
