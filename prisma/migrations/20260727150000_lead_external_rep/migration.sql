-- Externí obchodník jako vlastník kontaktu (lead z portálu obchodníka)
ALTER TABLE "compounder_leads" ADD COLUMN "external_rep_id" INTEGER;
CREATE INDEX "compounder_leads_external_rep_id_idx" ON "compounder_leads"("external_rep_id");
