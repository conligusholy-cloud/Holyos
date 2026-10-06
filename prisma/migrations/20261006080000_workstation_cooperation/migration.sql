-- Kooperace: externí pracoviště s dodavatelem a průběžnou dobou
ALTER TABLE "workstations" ADD COLUMN IF NOT EXISTS "supplier_company_id" INTEGER;
ALTER TABLE "workstations" ADD COLUMN IF NOT EXISTS "coop_lead_days" INTEGER;
ALTER TABLE "workstations" ADD COLUMN IF NOT EXISTS "coop_note" TEXT;
DO $$ BEGIN
  ALTER TABLE "workstations" ADD CONSTRAINT "workstations_supplier_company_id_fkey" FOREIGN KEY ("supplier_company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "workstations_supplier_company_id_idx" ON "workstations"("supplier_company_id");
CREATE INDEX IF NOT EXISTS "workstations_is_external_idx" ON "workstations"("is_external");
