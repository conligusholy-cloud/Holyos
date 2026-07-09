-- Obchod: přiřazený obchodník (owner) + kdo kontakt založil (creator).
-- Odkaz na people.id (bez FK constraintu — jméno se dohledá v aplikaci).
ALTER TABLE "compounder_leads" ADD COLUMN "owner_person_id" INTEGER;
ALTER TABLE "compounder_leads" ADD COLUMN "created_by_person_id" INTEGER;
CREATE INDEX "compounder_leads_owner_person_id_idx" ON "compounder_leads"("owner_person_id");
