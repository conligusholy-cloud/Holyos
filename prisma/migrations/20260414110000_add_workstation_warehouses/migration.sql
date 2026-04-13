-- Vstupní a výstupní sklad pro pracoviště
ALTER TABLE "workstations" ADD COLUMN "input_warehouse_id" INTEGER;
ALTER TABLE "workstations" ADD COLUMN "output_warehouse_id" INTEGER;

CREATE INDEX "workstations_input_warehouse_id_idx" ON "workstations"("input_warehouse_id");
CREATE INDEX "workstations_output_warehouse_id_idx" ON "workstations"("output_warehouse_id");

ALTER TABLE "workstations" ADD CONSTRAINT "workstations_input_warehouse_id_fkey" FOREIGN KEY ("input_warehouse_id") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "workstations" ADD CONSTRAINT "workstations_output_warehouse_id_fkey" FOREIGN KEY ("output_warehouse_id") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
