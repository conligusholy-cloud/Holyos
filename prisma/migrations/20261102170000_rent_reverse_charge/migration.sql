-- Nájem kiosku: zahraniční plátce DPH v EU — fakturace bez DPH (reverse charge)
ALTER TABLE "kiosk_rent_contracts" ADD COLUMN IF NOT EXISTS "reverse_charge" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "kiosk_rent_contracts" ADD COLUMN IF NOT EXISTS "buyer_vat_id" VARCHAR(20);
ALTER TABLE "kiosk_rent_statements" ADD COLUMN IF NOT EXISTS "reverse_charge" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "kiosk_rent_statements" ADD COLUMN IF NOT EXISTS "buyer_vat_id" VARCHAR(20);
