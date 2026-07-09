-- Zpřístupněné vzory smluv (mustry) ke čtení pro leada: CSV typů rezervacni,kupni,servisni.
ALTER TABLE "compounder_leads" ADD COLUMN "visible_templates" TEXT;
