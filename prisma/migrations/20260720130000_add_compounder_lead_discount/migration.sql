-- Sleva per-lead: ruční prodloužení (discount_until), trvalé zapnutí, vypnutí.
ALTER TABLE "compounder_leads" ADD COLUMN "discount_until" TIMESTAMP(3);
ALTER TABLE "compounder_leads" ADD COLUMN "discount_permanent" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "compounder_leads" ADD COLUMN "discount_disabled" BOOLEAN NOT NULL DEFAULT false;
