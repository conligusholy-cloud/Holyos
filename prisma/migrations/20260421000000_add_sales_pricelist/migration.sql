-- Prodejní ceník — samostatné prodejní položky s cenami v Kč a EUR (bez DPH).
-- Volitelné propojení na Product přes product_id (ON DELETE SET NULL).

-- CreateTable
CREATE TABLE "sales_pricelist_items" (
    "id" SERIAL NOT NULL,
    "name_cs" VARCHAR(255) NOT NULL,
    "name_en" VARCHAR(255),
    "price_czk" DECIMAL(12,2),
    "price_eur" DECIMAL(12,2),
    "product_id" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_pricelist_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sales_pricelist_items_product_id_idx" ON "sales_pricelist_items"("product_id");

-- CreateIndex
CREATE INDEX "sales_pricelist_items_active_idx" ON "sales_pricelist_items"("active");

-- AddForeignKey
ALTER TABLE "sales_pricelist_items" ADD CONSTRAINT "sales_pricelist_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
