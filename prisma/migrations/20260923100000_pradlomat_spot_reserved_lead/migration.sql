-- Předjednaná místa — rezervace na konkrétní lead.
ALTER TABLE "pradlomat_spots" ADD COLUMN IF NOT EXISTS "reserved_lead_id" INTEGER;
ALTER TABLE "pradlomat_spots" ADD COLUMN IF NOT EXISTS "reserved_lead_label" VARCHAR(255);
CREATE INDEX IF NOT EXISTS "pradlomat_spots_reserved_lead_id_idx" ON "pradlomat_spots" ("reserved_lead_id");
