-- Samostatný marketingový stav leadu (Centrum reklamy) oddělený od CRM stavu
ALTER TABLE "compounder_leads" ADD COLUMN IF NOT EXISTS "marketing_status" VARCHAR(40);
CREATE INDEX IF NOT EXISTS "compounder_leads_marketing_status_idx" ON "compounder_leads"("marketing_status");

-- Doplnění z existujících dat (podle časů odeslání a black listu); CRM `status` se nemění
UPDATE "compounder_leads" SET "marketing_status" = 'osloven_schuzka'
  WHERE "marketing_status" IS NULL AND ("schuzka_sms_sent_at" IS NOT NULL OR "schuzka_email_sent_at" IS NOT NULL);
UPDATE "compounder_leads" SET "marketing_status" = 'osloven_specialista'
  WHERE "marketing_status" IS NULL AND ("ai_specialist_sms_sent_at" IS NOT NULL OR "ai_specialist_email_sent_at" IS NOT NULL);
