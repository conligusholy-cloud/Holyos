-- Poznámky obchodníka u nabídky lokality (oddělené od owner_note zájemce).
ALTER TABLE "sites" ADD COLUMN IF NOT EXISTS "sales_notes" TEXT;
