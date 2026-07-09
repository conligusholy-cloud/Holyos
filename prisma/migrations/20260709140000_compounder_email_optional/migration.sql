-- Kontakt lze založit i jen s telefonem → e-mail už není povinný.
ALTER TABLE "compounder_leads" ALTER COLUMN "email" DROP NOT NULL;
