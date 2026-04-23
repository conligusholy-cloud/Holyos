-- CreateTable
CREATE TABLE "serial_numbers" (
    "id" SERIAL NOT NULL,
    "material_id" INTEGER NOT NULL,
    "serial_number" VARCHAR(100) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'in_stock',
    "location_id" INTEGER,
    "received_at" TIMESTAMP(3),
    "received_move_id" INTEGER,
    "issued_at" TIMESTAMP(3),
    "issued_move_id" INTEGER,
    "scrapped_at" TIMESTAMP(3),
    "returned_at" TIMESTAMP(3),
    "reference_type" VARCHAR(50),
    "reference_id" INTEGER,
    "received_by" INTEGER,
    "issued_by" INTEGER,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "serial_numbers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "serial_numbers_material_id_idx" ON "serial_numbers"("material_id");

-- CreateIndex
CREATE INDEX "serial_numbers_serial_number_idx" ON "serial_numbers"("serial_number");

-- CreateIndex
CREATE INDEX "serial_numbers_status_idx" ON "serial_numbers"("status");

-- CreateIndex
CREATE INDEX "serial_numbers_location_id_idx" ON "serial_numbers"("location_id");

-- CreateIndex
CREATE INDEX "serial_numbers_reference_type_reference_id_idx" ON "serial_numbers"("reference_type", "reference_id");

-- CreateIndex
CREATE UNIQUE INDEX "serial_numbers_material_id_serial_number_key" ON "serial_numbers"("material_id", "serial_number");

-- AddForeignKey
ALTER TABLE "serial_numbers" ADD CONSTRAINT "serial_numbers_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "serial_numbers" ADD CONSTRAINT "serial_numbers_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "warehouse_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "serial_numbers" ADD CONSTRAINT "serial_numbers_received_move_id_fkey" FOREIGN KEY ("received_move_id") REFERENCES "inventory_movements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "serial_numbers" ADD CONSTRAINT "serial_numbers_issued_move_id_fkey" FOREIGN KEY ("issued_move_id") REFERENCES "inventory_movements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "serial_numbers" ADD CONSTRAINT "serial_numbers_received_by_fkey" FOREIGN KEY ("received_by") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "serial_numbers" ADD CONSTRAINT "serial_numbers_issued_by_fkey" FOREIGN KEY ("issued_by") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;

