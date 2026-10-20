-- Nájem kiosku: pevná výše nájmu lokality bez DPH (kontroluje se proti přijatému dokladu)
ALTER TABLE "kiosk_rent_contracts" ADD COLUMN IF NOT EXISTS "rent_fixed_net" DECIMAL(14,2);
