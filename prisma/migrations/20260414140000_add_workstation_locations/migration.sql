-- Přidání skladových pozic k pracovišti (vstupní a výstupní)
ALTER TABLE "workstations" ADD COLUMN "input_location_id" INTEGER;
ALTER TABLE "workstations" ADD COLUMN "output_location_id" INTEGER;

-- Indexy
CREATE INDEX "workstations_input_location_id_idx" ON "workstations"("input_location_id");
CREATE INDEX "workstations_output_location_id_idx" ON "workstations"("output_location_id");

-- FK constraints
ALTER TABLE "workstations" ADD CONSTRAINT "workstations_input_location_id_fkey" FOREIGN KEY ("input_location_id") REFERENCES "warehouse_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "workstations" ADD CONSTRAINT "workstations_output_location_id_fkey" FOREIGN KEY ("output_location_id") REFERENCES "warehouse_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
