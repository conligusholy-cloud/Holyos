-- Paralelní (plovoucí) operace v pracovním postupu
ALTER TABLE "product_operations" ADD COLUMN IF NOT EXISTS "is_parallel" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "product_operations" ADD COLUMN IF NOT EXISTS "parallel_from" INTEGER;
ALTER TABLE "product_operations" ADD COLUMN IF NOT EXISTS "parallel_to" INTEGER;
