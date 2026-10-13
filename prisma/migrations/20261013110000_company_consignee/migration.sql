-- Příjemce zboží u společnosti (self-relation)
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "consignee_id" INTEGER;
CREATE INDEX IF NOT EXISTS "companies_consignee_id_idx" ON "companies"("consignee_id");
DO $$ BEGIN
  ALTER TABLE "companies" ADD CONSTRAINT "companies_consignee_id_fkey" FOREIGN KEY ("consignee_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
