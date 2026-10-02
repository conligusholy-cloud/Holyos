-- Výrobní dávka: požadovaný termín + testovací příznaky
ALTER TABLE "production_batches" ADD COLUMN IF NOT EXISTS "due_date" TIMESTAMP(3);
ALTER TABLE "production_batches" ADD COLUMN IF NOT EXISTS "is_test" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "production_batches" ADD COLUMN IF NOT EXISTS "ignore_stock" BOOLEAN NOT NULL DEFAULT false;
