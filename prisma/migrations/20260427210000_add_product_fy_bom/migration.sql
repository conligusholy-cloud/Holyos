-- CreateTable: Factorify referenční sestava zboží (FY BOM) — 1:1 s Product, last-import wins
CREATE TABLE "product_fy_boms" (
    "id" SERIAL NOT NULL,
    "product_id" INTEGER NOT NULL,
    "imported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "imported_by_id" INTEGER,
    "imported_by" VARCHAR(120),
    "source_filename" VARCHAR(255),
    "row_count" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,

    CONSTRAINT "product_fy_boms_pkey" PRIMARY KEY ("id")
);

-- CreateTable: Položky FY sestavy — surová data z Factorify exportu (žádný FK na Material)
CREATE TABLE "product_fy_bom_items" (
    "id" SERIAL NOT NULL,
    "fy_bom_id" INTEGER NOT NULL,
    "level" VARCHAR(20),
    "factorify_item_id" INTEGER,
    "name" VARCHAR(500) NOT NULL,
    "quantity" DECIMAL(14,4),
    "unit" VARCHAR(20),
    "item_type" VARCHAR(50),
    "keywords" TEXT,
    "status" VARCHAR(50),
    "photo" VARCHAR(500),
    "ignore_stock" BOOLEAN NOT NULL DEFAULT false,
    "used_in_operations" TEXT,
    "used_at_workstations" TEXT,
    "is_purchasable" BOOLEAN NOT NULL DEFAULT false,
    "has_workflow" BOOLEAN NOT NULL DEFAULT false,
    "drawing" VARCHAR(500),
    "drawing_is_draft" BOOLEAN NOT NULL DEFAULT false,
    "defined_in" VARCHAR(120),
    "position" VARCHAR(120),
    "row_index" INTEGER NOT NULL,

    CONSTRAINT "product_fy_bom_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "product_fy_boms_product_id_key" ON "product_fy_boms"("product_id");
CREATE INDEX "product_fy_bom_items_fy_bom_id_row_index_idx" ON "product_fy_bom_items"("fy_bom_id", "row_index");
CREATE INDEX "product_fy_bom_items_factorify_item_id_idx" ON "product_fy_bom_items"("factorify_item_id");

-- AddForeignKey
ALTER TABLE "product_fy_boms" ADD CONSTRAINT "product_fy_boms_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "product_fy_bom_items" ADD CONSTRAINT "product_fy_bom_items_fy_bom_id_fkey" FOREIGN KEY ("fy_bom_id") REFERENCES "product_fy_boms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
