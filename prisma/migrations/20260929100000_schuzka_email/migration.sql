-- Schůzka: automatický / testovací e-mail s odkazem na cestu k rozhodnutí
ALTER TABLE "compounder_leads" ADD COLUMN IF NOT EXISTS "schuzka_email_sent_at" TIMESTAMP(3);
ALTER TABLE "compounder_leads" ADD COLUMN IF NOT EXISTS "schuzka_email_status" VARCHAR(40);
