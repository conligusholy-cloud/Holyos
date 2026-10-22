-- Schůzky: interní poznámka k rezervaci (z Velínu, lze diktovat)
ALTER TABLE "meeting_reservations" ADD COLUMN IF NOT EXISTS "internal_note" TEXT;
