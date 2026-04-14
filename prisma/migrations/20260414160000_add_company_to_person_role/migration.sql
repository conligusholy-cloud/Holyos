-- Přidej vazbu osoba → společnost
ALTER TABLE "people" ADD COLUMN "company_id" INTEGER;
CREATE INDEX "people_company_id_idx" ON "people"("company_id");
ALTER TABLE "people" ADD CONSTRAINT "people_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Přidej vazbu role → společnost
ALTER TABLE "roles" ADD COLUMN "company_id" INTEGER;
CREATE INDEX "roles_company_id_idx" ON "roles"("company_id");
ALTER TABLE "roles" ADD CONSTRAINT "roles_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
