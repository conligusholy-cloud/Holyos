-- Meta (Facebook/Instagram) Lead Ads → CompounderLead
-- Pole pro příjem leadů z FB rychlých formulářů + párování na nastavení formulářů.

ALTER TABLE "compounder_leads" ADD COLUMN IF NOT EXISTS "meta_lead_id" VARCHAR(64);
ALTER TABLE "compounder_leads" ADD COLUMN IF NOT EXISTS "meta_form_id" VARCHAR(64);
ALTER TABLE "compounder_leads" ADD COLUMN IF NOT EXISTS "meta_page_id" VARCHAR(64);
ALTER TABLE "compounder_leads" ADD COLUMN IF NOT EXISTS "meta_ad_id" VARCHAR(64);
ALTER TABLE "compounder_leads" ADD COLUMN IF NOT EXISTS "campaign" VARCHAR(160);
ALTER TABLE "compounder_leads" ADD COLUMN IF NOT EXISTS "meta_raw" JSONB;

-- Idempotence příjmu (stejný FB lead se nezaloží dvakrát).
CREATE UNIQUE INDEX IF NOT EXISTS "compounder_leads_meta_lead_id_key" ON "compounder_leads"("meta_lead_id");
CREATE INDEX IF NOT EXISTS "compounder_leads_meta_form_id_idx" ON "compounder_leads"("meta_form_id");
