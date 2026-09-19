-- ServiceRequest: přímá vazba na hovor Infolinky (z kterého hovoru požadavek vznikl)
ALTER TABLE "service_requests" ADD COLUMN IF NOT EXISTS "voice_call_id" VARCHAR(64);
CREATE INDEX IF NOT EXISTS "service_requests_voice_call_id_idx" ON "service_requests"("voice_call_id");
