-- Barevné varianty materiálu (varianta = samostatná skladová karta s parent_material_id)
ALTER TABLE "materials" ADD COLUMN IF NOT EXISTS "parent_material_id" INTEGER;
ALTER TABLE "materials" ADD COLUMN IF NOT EXISTS "color_name" VARCHAR(60);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'materials_parent_material_id_fkey') THEN
    ALTER TABLE "materials" ADD CONSTRAINT "materials_parent_material_id_fkey" FOREIGN KEY ("parent_material_id") REFERENCES "materials"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS "materials_parent_material_id_idx" ON "materials"("parent_material_id");
