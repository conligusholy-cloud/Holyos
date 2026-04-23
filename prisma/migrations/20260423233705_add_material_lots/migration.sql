-- DropIndex
DROP INDEX "stock_material_id_location_id_key";

-- AlterTable
ALTER TABLE "stock" ADD COLUMN     "lot_id" INTEGER;

-- CreateTable
CREATE TABLE "material_lots" (
    "id" SERIAL NOT NULL,
    "material_id" INTEGER NOT NULL,
    "lot_code" VARCHAR(100) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'in_stock',
    "manufactured_at" DATE,
    "expires_at" DATE,
    "supplier_id" INTEGER,
    "supplier_lot_ref" VARCHAR(100),
    "received_at" TIMESTAMP(3),
    "received_move_id" INTEGER,
    "received_by" INTEGER,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "material_lots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "material_lots_material_id_idx" ON "material_lots"("material_id");

-- CreateIndex
CREATE INDEX "material_lots_status_idx" ON "material_lots"("status");

-- CreateIndex
CREATE INDEX "material_lots_expires_at_idx" ON "material_lots"("expires_at");

-- CreateIndex
CREATE INDEX "material_lots_supplier_id_idx" ON "material_lots"("supplier_id");

-- CreateIndex
CREATE UNIQUE INDEX "material_lots_material_id_lot_code_key" ON "material_lots"("material_id", "lot_code");

-- CreateIndex
CREATE INDEX "stock_lot_id_idx" ON "stock"("lot_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_material_id_location_id_lot_id_key" ON "stock"("material_id", "location_id", "lot_id");

-- AddForeignKey
ALTER TABLE "stock" ADD CONSTRAINT "stock_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "material_lots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_lots" ADD CONSTRAINT "material_lots_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_lots" ADD CONSTRAINT "material_lots_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_lots" ADD CONSTRAINT "material_lots_received_move_id_fkey" FOREIGN KEY ("received_move_id") REFERENCES "inventory_movements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_lots" ADD CONSTRAINT "material_lots_received_by_fkey" FOREIGN KEY ("received_by") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;

