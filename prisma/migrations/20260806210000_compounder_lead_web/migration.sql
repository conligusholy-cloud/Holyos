-- Compounder lead: webová stránka kontaktu
ALTER TABLE "compounder_leads" ADD COLUMN IF NOT EXISTS "web" VARCHAR(300);
