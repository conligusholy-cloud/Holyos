-- Celní řízení u firmy (export do UK / mimo EU): VAT ID GB, EORI GB, obecné EORI, poznámka
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "vat_id_gb" VARCHAR(30);
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "eori_gb" VARCHAR(30);
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "eori" VARCHAR(30);
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "customs_note" TEXT;
