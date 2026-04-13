-- Přidej product_id do operation_materials pro přímou vazbu na výrobek/polotovar
ALTER TABLE "operation_materials" ADD COLUMN "product_id" INTEGER;

-- CreateIndex
CREATE INDEX "operation_materials_product_id_idx" ON "operation_materials"("product_id");

-- AddForeignKey
ALTER TABLE "operation_materials" ADD CONSTRAINT "operation_materials_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
