-- AI analýza zákaznického potenciálu u předjednaného místa
ALTER TABLE "pradlomat_spots" ADD COLUMN IF NOT EXISTS "potential_report" TEXT;
ALTER TABLE "pradlomat_spots" ADD COLUMN IF NOT EXISTS "potential_generated_at" TIMESTAMP(3);
