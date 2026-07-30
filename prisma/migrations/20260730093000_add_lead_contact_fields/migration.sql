-- HolyOS — Strukturovaná pole kontaktu u CompounderLead
-- Přidá jméno, příjmení, firmu, město a zemi. Idempotentní (IF NOT EXISTS),
-- aby migrace bezpečně proběhla i při částečně aplikovaném stavu na Railway.
ALTER TABLE "compounder_leads" ADD COLUMN IF NOT EXISTS "first_name" VARCHAR(120);
ALTER TABLE "compounder_leads" ADD COLUMN IF NOT EXISTS "last_name"  VARCHAR(120);
ALTER TABLE "compounder_leads" ADD COLUMN IF NOT EXISTS "company"    VARCHAR(200);
ALTER TABLE "compounder_leads" ADD COLUMN IF NOT EXISTS "city"       VARCHAR(120);
ALTER TABLE "compounder_leads" ADD COLUMN IF NOT EXISTS "country"    VARCHAR(120);
