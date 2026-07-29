-- Testovací kontakt: vyřadí lead ze statistik obchodníka.
ALTER TABLE "compounder_leads" ADD COLUMN "is_test" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "compounder_leads_is_test_idx" ON "compounder_leads"("is_test");
