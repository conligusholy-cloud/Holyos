-- CAD import protokol: celková doba běhu importu
ALTER TABLE "cad_import_batches" ADD COLUMN IF NOT EXISTS "duration_ms" INTEGER;
