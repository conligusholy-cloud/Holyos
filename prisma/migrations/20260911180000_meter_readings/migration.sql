-- Odečty stavů měřidel (voda/elektro) — mobilní formulář pro odečty
CREATE TABLE IF NOT EXISTS "meter_readings" (
  "id" SERIAL NOT NULL,
  "water_m3" DECIMAL(12,3),
  "water_photo_url" VARCHAR(500),
  "electricity_kwh" DECIMAL(12,2),
  "electricity_photo_url" VARCHAR(500),
  "machine_id" INTEGER,
  "machine_name" VARCHAR(200),
  "note" TEXT,
  "created_by_user_id" INTEGER,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "meter_readings_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "meter_readings_machine_id_idx" ON "meter_readings"("machine_id");
CREATE INDEX IF NOT EXISTS "meter_readings_created_at_idx" ON "meter_readings"("created_at");
