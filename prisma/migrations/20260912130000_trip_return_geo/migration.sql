-- Souřadnice + doba cesty zpět (kreslení zpáteční trasy na mapě Kontrola týmu)
ALTER TABLE "service_trips" ADD COLUMN IF NOT EXISTS "return_lat" DECIMAL(9,6);
ALTER TABLE "service_trips" ADD COLUMN IF NOT EXISTS "return_lon" DECIMAL(9,6);
ALTER TABLE "service_trips" ADD COLUMN IF NOT EXISTS "return_duration_min" INTEGER;
