-- CompounderLead: viditelné sekce portálu (CSV klíčů skupin), null = výchozí (jen ekonomika)
ALTER TABLE "compounder_leads" ADD COLUMN IF NOT EXISTS "visible_sections" TEXT;
