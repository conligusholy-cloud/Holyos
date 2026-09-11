-- Časomíra vlastní opravy + cesta zpět + odhad opravy (evidence času k úkolu)
ALTER TABLE "service_trips" ADD COLUMN IF NOT EXISTS "repair_started_at" TIMESTAMP(3);
ALTER TABLE "service_trips" ADD COLUMN IF NOT EXISTS "repair_ended_at" TIMESTAMP(3);
ALTER TABLE "service_trips" ADD COLUMN IF NOT EXISTS "return_started_at" TIMESTAMP(3);
ALTER TABLE "service_trips" ADD COLUMN IF NOT EXISTS "return_ended_at" TIMESTAMP(3);
ALTER TABLE "service_trips" ADD COLUMN IF NOT EXISTS "return_destination" VARCHAR(255);
ALTER TABLE "service_trips" ADD COLUMN IF NOT EXISTS "return_km" DECIMAL(8,1);
ALTER TABLE "service_requests" ADD COLUMN IF NOT EXISTS "est_repair_min" INTEGER;
