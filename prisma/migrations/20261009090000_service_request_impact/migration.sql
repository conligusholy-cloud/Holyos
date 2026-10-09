-- Servisní požadavek: dopad na provoz pro přehled „Aktuální omezení" (Infolinka)
ALTER TABLE "service_requests" ADD COLUMN IF NOT EXISTS "impact" VARCHAR(20) NOT NULL DEFAULT 'none';
ALTER TABLE "service_requests" ADD COLUMN IF NOT EXISTS "devices" JSONB;
ALTER TABLE "service_requests" ADD COLUMN IF NOT EXISTS "show_infoline" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "service_requests" ADD COLUMN IF NOT EXISTS "infoline_note" VARCHAR(500);
ALTER TABLE "service_requests" ADD COLUMN IF NOT EXISTS "impact_since" TIMESTAMP(3);
ALTER TABLE "service_requests" ADD COLUMN IF NOT EXISTS "resolved_at" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "service_requests_show_infoline_status_idx" ON "service_requests"("show_infoline", "status");
