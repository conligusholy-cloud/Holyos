-- Kdy lead poprvé otevřel odkaz na AI specialistu (stránku /ai)
ALTER TABLE "compounder_leads" ADD COLUMN "ai_specialist_opened_at" TIMESTAMP(3);
