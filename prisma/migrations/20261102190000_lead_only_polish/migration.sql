-- Kontakt, který umí jen polsky (ruční příznak obchodníka)
ALTER TABLE "compounder_leads" ADD COLUMN IF NOT EXISTS "only_polish" BOOLEAN NOT NULL DEFAULT false;
