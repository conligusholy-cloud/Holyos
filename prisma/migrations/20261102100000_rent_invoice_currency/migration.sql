-- Nájem kiosku: fakturace v cizí měně (výpočet v Kč, výsledek přepočten kurzem ČNB)
ALTER TABLE "kiosk_rent_contracts" ADD COLUMN IF NOT EXISTS "invoice_currency" VARCHAR(3) NOT NULL DEFAULT 'CZK';
ALTER TABLE "kiosk_rent_statements" ADD COLUMN IF NOT EXISTS "invoice_currency" VARCHAR(3);
ALTER TABLE "kiosk_rent_statements" ADD COLUMN IF NOT EXISTS "fx_rate" DECIMAL(10,4);
ALTER TABLE "kiosk_rent_statements" ADD COLUMN IF NOT EXISTS "fx_rate_date" VARCHAR(10);
ALTER TABLE "kiosk_rent_statements" ADD COLUMN IF NOT EXISTS "rent_invoice" DECIMAL(14,2);
