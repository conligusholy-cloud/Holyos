-- Výchozí kontakt firmy pro nákupní objednávky a poptávky
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "order_contact_person_id" INTEGER;
