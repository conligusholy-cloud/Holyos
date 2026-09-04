-- Odeslani odkazu na specialistu e-mailem (A/B SMS vs e-mail)
ALTER TABLE "compounder_leads" ADD COLUMN "ai_specialist_email_sent_at" TIMESTAMP(3);
ALTER TABLE "compounder_leads" ADD COLUMN "ai_specialist_email_status" TEXT;
