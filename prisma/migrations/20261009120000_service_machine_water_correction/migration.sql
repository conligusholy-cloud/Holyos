-- Stroj v provozu: korekce vodoměru (m3)
ALTER TABLE "service_machines" ADD COLUMN IF NOT EXISTS "water_correction" DECIMAL(12,3);
