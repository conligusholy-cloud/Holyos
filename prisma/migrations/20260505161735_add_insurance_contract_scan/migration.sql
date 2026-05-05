-- =============================================================================
-- HolyOS — VehicleInsurancePolicy: oddělit pojistnou Smlouvu od Zelené karty
-- =============================================================================
-- Existující file_url + file_name zůstává (sémanticky teď = Zelená karta).
-- Nová pole contract_url + contract_name = Smlouva scan (PDF / obrázek).
ALTER TABLE "vehicle_insurance_policies"
  ADD COLUMN "contract_url"  VARCHAR(500),
  ADD COLUMN "contract_name" VARCHAR(255);
