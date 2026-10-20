-- Nájem kiosku: pravidla pro F (servis/díly), AI vyhledání dokladů, návrhy k potvrzení
ALTER TABLE "kiosk_rent_contracts" ADD COLUMN IF NOT EXISTS "service_rules" JSONB;
ALTER TABLE "kiosk_rent_contracts" ADD COLUMN IF NOT EXISTS "ai_match" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "kiosk_rent_statements" ADD COLUMN IF NOT EXISTS "suggestions" JSONB;
