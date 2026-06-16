-- Kategorie zboží — stromová hierarchie (osnova) pro modul Nákup a sklad
CREATE TABLE "material_categories" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "parent_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "material_categories_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "material_categories_parent_id_idx" ON "material_categories"("parent_id");
CREATE INDEX "material_categories_sort_order_idx" ON "material_categories"("sort_order");

ALTER TABLE "material_categories" ADD CONSTRAINT "material_categories_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "material_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Material.category_id — zařazení zboží do kategorie
ALTER TABLE "materials" ADD COLUMN "category_id" INTEGER;

CREATE INDEX "materials_category_id_idx" ON "materials"("category_id");

ALTER TABLE "materials" ADD CONSTRAINT "materials_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "material_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
