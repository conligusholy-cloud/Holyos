-- Hotové výrobky na konci pracovního postupu
CREATE TABLE IF NOT EXISTS "product_outputs" (
  "id" SERIAL NOT NULL,
  "product_id" INTEGER NOT NULL,
  "out_product_id" INTEGER,
  "out_material_id" INTEGER,
  "quantity" DECIMAL(12,3) NOT NULL DEFAULT 1,
  "unit" VARCHAR(20) NOT NULL DEFAULT 'ks',
  "note" VARCHAR(255),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "product_outputs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "product_outputs_product_id_idx" ON "product_outputs"("product_id");
CREATE INDEX IF NOT EXISTS "product_outputs_out_product_id_idx" ON "product_outputs"("out_product_id");
CREATE INDEX IF NOT EXISTS "product_outputs_out_material_id_idx" ON "product_outputs"("out_material_id");
DO $$ BEGIN
  ALTER TABLE "product_outputs" ADD CONSTRAINT "product_outputs_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "product_outputs" ADD CONSTRAINT "product_outputs_out_product_id_fkey" FOREIGN KEY ("out_product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "product_outputs" ADD CONSTRAINT "product_outputs_out_material_id_fkey" FOREIGN KEY ("out_material_id") REFERENCES "materials"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
