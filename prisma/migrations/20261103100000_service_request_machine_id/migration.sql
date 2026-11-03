-- Vazba servisního požadavku na konkrétní stroj/lokalitu (ServiceMachine.id).
-- Dosud se lokalita držela jen jako text v `problem`, takže infolinka i AI musely
-- párovat podle názvu. ID je spolehlivé; název zůstává jako záloha.
ALTER TABLE "service_requests" ADD COLUMN IF NOT EXISTS "machine_id" INTEGER;
CREATE INDEX IF NOT EXISTS "service_requests_machine_id_idx" ON "service_requests"("machine_id");
