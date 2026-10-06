-- Výbava výrobku (kombinace variant operací)
CREATE TABLE IF NOT EXISTS "product_equipments" (
  "id" SERIAL NOT NULL,
  "product_id" INTEGER NOT NULL,
  "group_name" VARCHAR(80) NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "variant_ids" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
  "sort" INTEGER NOT NULL DEFAULT 0,
  "note" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "product_equipments_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "product_equipments_product_id_idx" ON "product_equipments"("product_id");
DO $$ BEGIN
  ALTER TABLE "product_equipments" ADD CONSTRAINT "product_equipments_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
