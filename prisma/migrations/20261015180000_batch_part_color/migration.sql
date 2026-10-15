-- Barva dílů dávky (záměna barevných variant materiálu podle volby při zadání do výroby)
ALTER TABLE "production_batches" ADD COLUMN IF NOT EXISTS "part_color" VARCHAR(60);
