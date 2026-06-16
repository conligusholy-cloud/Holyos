-- Přidání telefonního čísla k Compounder leadu (žádost o kontakt z portálu)
ALTER TABLE "compounder_leads" ADD COLUMN "phone" VARCHAR(40);
