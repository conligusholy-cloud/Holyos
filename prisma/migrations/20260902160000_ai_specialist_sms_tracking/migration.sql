-- Záznam odeslané SMS s odkazem na AI specialistu (kdy, GoSMS id, stav doručení)
ALTER TABLE "compounder_leads" ADD COLUMN "ai_specialist_sms_sent_at" TIMESTAMP(3);
ALTER TABLE "compounder_leads" ADD COLUMN "ai_specialist_sms_id" TEXT;
ALTER TABLE "compounder_leads" ADD COLUMN "ai_specialist_sms_status" TEXT;
