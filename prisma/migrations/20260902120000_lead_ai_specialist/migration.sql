-- Záložka „AI Specialista" na Compounder portálu — per-lead přepínač
ALTER TABLE "compounder_leads" ADD COLUMN "show_ai_specialist" BOOLEAN NOT NULL DEFAULT false;
