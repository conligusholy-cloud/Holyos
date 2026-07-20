-- Kalendář obchodníka: napojení SalesEvent na M365/Outlook + vazba na lokalitu/Compounder lead.
ALTER TABLE "sales_events" ADD COLUMN IF NOT EXISTS "compounder_lead_id" INTEGER;
ALTER TABLE "sales_events" ADD COLUMN IF NOT EXISTS "site_id" INTEGER;
ALTER TABLE "sales_events" ADD COLUMN IF NOT EXISTS "graph_event_id" VARCHAR(255);
ALTER TABLE "sales_events" ADD COLUMN IF NOT EXISTS "graph_calendar_user" VARCHAR(255);
ALTER TABLE "sales_events" ADD COLUMN IF NOT EXISTS "graph_sync_error" TEXT;
CREATE INDEX IF NOT EXISTS "sales_events_compounder_lead_id_idx" ON "sales_events"("compounder_lead_id");
CREATE INDEX IF NOT EXISTS "sales_events_site_id_idx" ON "sales_events"("site_id");
