-- Obrázek v e-mailu kampaně (hra — e-mailing)
ALTER TABLE "game_mail_campaigns" ADD COLUMN IF NOT EXISTS "image_url" VARCHAR(500);
