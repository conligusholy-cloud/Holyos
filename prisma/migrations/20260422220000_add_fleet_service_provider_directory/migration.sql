-- Adresář servisních firem pro vozový park (sdílí tabulku companies).
-- Rozšiřuje Company o adresu provozovny a přidává FK service_company_id
-- na vehicle_services a vehicle_tire_changes.
--
-- Idempotentní — lze opakovaně aplikovat. Používá IF NOT EXISTS
-- pro ALTER TABLE a DO $$ bloky pro constraint check.

-- ─── Company: adresa provozovny ───────────────────────────────────────────
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "branch_address" VARCHAR(255);
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "branch_city" VARCHAR(100);
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "branch_zip" VARCHAR(10);

-- ─── VehicleService: FK na firmu v adresáři ───────────────────────────────
ALTER TABLE "vehicle_services" ADD COLUMN IF NOT EXISTS "service_company_id" INTEGER;
CREATE INDEX IF NOT EXISTS "vehicle_services_service_company_id_idx"
  ON "vehicle_services"("service_company_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'vehicle_services_service_company_id_fkey'
      AND conrelid = '"vehicle_services"'::regclass
  ) THEN
    ALTER TABLE "vehicle_services"
      ADD CONSTRAINT "vehicle_services_service_company_id_fkey"
      FOREIGN KEY ("service_company_id") REFERENCES "companies"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END$$;

-- ─── VehicleTireChange: FK na firmu v adresáři ────────────────────────────
ALTER TABLE "vehicle_tire_changes" ADD COLUMN IF NOT EXISTS "service_company_id" INTEGER;
CREATE INDEX IF NOT EXISTS "vehicle_tire_changes_service_company_id_idx"
  ON "vehicle_tire_changes"("service_company_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'vehicle_tire_changes_service_company_id_fkey'
      AND conrelid = '"vehicle_tire_changes"'::regclass
  ) THEN
    ALTER TABLE "vehicle_tire_changes"
      ADD CONSTRAINT "vehicle_tire_changes_service_company_id_fkey"
      FOREIGN KEY ("service_company_id") REFERENCES "companies"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END$$;
