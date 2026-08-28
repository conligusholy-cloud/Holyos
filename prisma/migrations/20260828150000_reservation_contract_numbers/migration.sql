-- Trvalá čísla smluv u rezervace (přidělí se jednou, už se nemění).
ALTER TABLE "location_reservations" ADD COLUMN IF NOT EXISTS "contract_seq" INTEGER;
ALTER TABLE "location_reservations" ADD COLUMN IF NOT EXISTS "contract_no_kupni" VARCHAR(20);
ALTER TABLE "location_reservations" ADD COLUMN IF NOT EXISTS "contract_no_najemni" VARCHAR(20);
ALTER TABLE "location_reservations" ADD COLUMN IF NOT EXISTS "contract_year" INTEGER;
