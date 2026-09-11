-- Souřadnice + doba jízdy pro mapu „Kontrola servisního týmu" (pohyb figurky po trase)
ALTER TABLE "service_trips" ADD COLUMN IF NOT EXISTS "origin_lat" DECIMAL(9,6);
ALTER TABLE "service_trips" ADD COLUMN IF NOT EXISTS "origin_lon" DECIMAL(9,6);
ALTER TABLE "service_trips" ADD COLUMN IF NOT EXISTS "dest_lat" DECIMAL(9,6);
ALTER TABLE "service_trips" ADD COLUMN IF NOT EXISTS "dest_lon" DECIMAL(9,6);
ALTER TABLE "service_trips" ADD COLUMN IF NOT EXISTS "distance_km" DECIMAL(8,1);
ALTER TABLE "service_trips" ADD COLUMN IF NOT EXISTS "duration_min" INTEGER;
ALTER TABLE "service_trips" ADD COLUMN IF NOT EXISTS "arrived" BOOLEAN NOT NULL DEFAULT false;
