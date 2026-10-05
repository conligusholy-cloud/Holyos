-- Dávka: původní (první) naplánovaný termín
ALTER TABLE "production_batches" ADD COLUMN IF NOT EXISTS "original_planned_start" TIMESTAMP(3);
ALTER TABLE "production_batches" ADD COLUMN IF NOT EXISTS "original_planned_end" TIMESTAMP(3);
