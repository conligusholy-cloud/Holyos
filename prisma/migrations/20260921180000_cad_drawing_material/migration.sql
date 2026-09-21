-- CAD výkres ↔ katalog zboží (Material): napojení auto při importu
ALTER TABLE "cad_drawings" ADD COLUMN IF NOT EXISTS "material_id" INTEGER;

CREATE INDEX IF NOT EXISTS "cad_drawings_material_id_idx" ON "cad_drawings"("material_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'cad_drawings_material_id_fkey'
      AND table_name = 'cad_drawings'
  ) THEN
    ALTER TABLE "cad_drawings"
      ADD CONSTRAINT "cad_drawings_material_id_fkey"
      FOREIGN KEY ("material_id") REFERENCES "materials"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
