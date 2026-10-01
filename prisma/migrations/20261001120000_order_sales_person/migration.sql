-- Objednávka: odpovědný obchodník (kdo obchod zrealizoval)
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "sales_person_id" INTEGER;
CREATE INDEX IF NOT EXISTS "orders_sales_person_id_idx" ON "orders"("sales_person_id");
DO $$ BEGIN
  ALTER TABLE "orders" ADD CONSTRAINT "orders_sales_person_id_fkey"
    FOREIGN KEY ("sales_person_id") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
