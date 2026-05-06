-- =============================================================================
-- HolyOS — VehicleInsurancePolicy: FK na Company + 4 doplňková krytí
-- =============================================================================
-- company_id je FK na adresář firem (Company). company_name (text) zůstává jako
-- fallback pro starší data, postupně se bude nahrazovat odkazem.
-- 4 booleany reprezentují krytí, která lze ke každé pojistce připnout zvlášť.

ALTER TABLE "vehicle_insurance_policies"
  ADD COLUMN "company_id"    INTEGER,
  ADD COLUMN "has_havarijni" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "has_glass"     BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "has_animal"    BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "has_natural"   BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "vehicle_insurance_policies"
  ADD CONSTRAINT "vehicle_insurance_policies_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "vehicle_insurance_policies_company_id_idx" ON "vehicle_insurance_policies"("company_id");
