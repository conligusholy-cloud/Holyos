-- Oddělený append-only log aktivit (řádek po řádku s časem), mimo volné poznámky.
ALTER TABLE "compounder_leads" ADD COLUMN "activity_log" TEXT;
