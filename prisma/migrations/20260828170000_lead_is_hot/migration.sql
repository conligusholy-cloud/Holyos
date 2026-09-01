-- „Zajímavý kontakt" — ruční příznak horkého kontaktu (není stav).
ALTER TABLE "compounder_leads" ADD COLUMN IF NOT EXISTS "is_hot" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS "compounder_leads_is_hot_idx" ON "compounder_leads"("is_hot");
