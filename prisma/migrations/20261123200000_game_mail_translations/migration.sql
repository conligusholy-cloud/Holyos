-- Automatické překlady kampaně do jazyka příjemce (hra — e-mailing)
ALTER TABLE "game_mail_campaigns" ADD COLUMN IF NOT EXISTS "translations" JSONB;
