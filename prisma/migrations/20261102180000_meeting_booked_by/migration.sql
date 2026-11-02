-- Schůzka s majitelem domluvená obchodníkem: evidence, kdo ji domluvil a komu kontakt patřil dřív
ALTER TABLE "meeting_reservations" ADD COLUMN IF NOT EXISTS "booked_by_person_id" INTEGER;
ALTER TABLE "meeting_reservations" ADD COLUMN IF NOT EXISTS "previous_owner_person_id" INTEGER;
CREATE INDEX IF NOT EXISTS "meeting_reservations_booked_by_person_id_idx" ON "meeting_reservations"("booked_by_person_id");
