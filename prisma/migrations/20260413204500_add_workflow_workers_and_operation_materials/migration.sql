-- AlterTable: Přidej workers_count a description do product_operations
ALTER TABLE "product_operations" ADD COLUMN "workers_count" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "product_operations" ADD COLUMN "description" TEXT;

-- CreateTable: Materiály spotřebované v operaci
CREATE TABLE "operation_materials" (
    "id" SERIAL NOT NULL,
    "operation_id" INTEGER NOT NULL,
    "material_id" INTEGER NOT NULL,
    "quantity" DECIMAL(10,3) NOT NULL,
    "unit" VARCHAR(20) NOT NULL DEFAULT 'ks',

    CONSTRAINT "operation_materials_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "operation_materials_operation_id_idx" ON "operation_materials"("operation_id");
CREATE INDEX "operation_materials_material_id_idx" ON "operation_materials"("material_id");

-- AddForeignKey
ALTER TABLE "operation_materials" ADD CONSTRAINT "operation_materials_operation_id_fkey" FOREIGN KEY ("operation_id") REFERENCES "product_operations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "operation_materials" ADD CONSTRAINT "operation_materials_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
