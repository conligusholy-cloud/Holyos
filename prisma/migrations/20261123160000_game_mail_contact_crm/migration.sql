-- E-mailing hry: údaje o kontaktu ze starého CRM (stav, typ kontaktu, země, datum získání, původní id).
ALTER TABLE "game_mail_contacts" ADD COLUMN IF NOT EXISTS "stage" VARCHAR(60);
ALTER TABLE "game_mail_contacts" ADD COLUMN IF NOT EXISTS "kind" VARCHAR(80);
ALTER TABLE "game_mail_contacts" ADD COLUMN IF NOT EXISTS "country" VARCHAR(80);
ALTER TABLE "game_mail_contacts" ADD COLUMN IF NOT EXISTS "acquired_at" DATE;
ALTER TABLE "game_mail_contacts" ADD COLUMN IF NOT EXISTS "ext_id" VARCHAR(40);
CREATE INDEX IF NOT EXISTS "game_mail_contacts_stage_idx" ON "game_mail_contacts"("stage");
CREATE INDEX IF NOT EXISTS "game_mail_contacts_kind_idx" ON "game_mail_contacts"("kind");
CREATE INDEX IF NOT EXISTS "game_mail_contacts_country_idx" ON "game_mail_contacts"("country");
