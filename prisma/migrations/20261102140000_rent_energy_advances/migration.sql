-- Nájem kiosku: pevné měsíční zálohy na energie (E)
ALTER TABLE "kiosk_rent_contracts" ADD COLUMN IF NOT EXISTS "energy_advances" JSONB;
