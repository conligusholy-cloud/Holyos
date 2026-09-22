-- Předjednaná místa — veřejný název + parametry z analýzy okolí.
ALTER TABLE "pradlomat_spots" ADD COLUMN IF NOT EXISTS "public_title" VARCHAR(255);
ALTER TABLE "pradlomat_spots" ADD COLUMN IF NOT EXISTS "has_parking" BOOLEAN;
ALTER TABLE "pradlomat_spots" ADD COLUMN IF NOT EXISTS "parking_distance_m" INTEGER;
ALTER TABLE "pradlomat_spots" ADD COLUMN IF NOT EXISTS "population" INTEGER;
ALTER TABLE "pradlomat_spots" ADD COLUMN IF NOT EXISTS "anchor_count" INTEGER;
ALTER TABLE "pradlomat_spots" ADD COLUMN IF NOT EXISTS "competition_count" INTEGER;
ALTER TABLE "pradlomat_spots" ADD COLUMN IF NOT EXISTS "score" INTEGER;
