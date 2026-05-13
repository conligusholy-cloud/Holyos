-- Migration: add_slot_reservation
-- Rezervace slotu na 3 dny pro klienta s časovým limitem na zaplacení zálohy.
-- Defaultní okno: 72 hodin (env SLOT_RESERVATION_HOURS).
-- Worker uvolní expirované rezervace.

ALTER TABLE "slot_assignments"
  ADD COLUMN IF NOT EXISTS "reservation_status"        VARCHAR(20),
  ADD COLUMN IF NOT EXISTS "reserved_until"            TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "reservation_confirmed_at"  TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "slot_assignments_reservation_status_idx"
  ON "slot_assignments" ("reservation_status");
CREATE INDEX IF NOT EXISTS "slot_assignments_reserved_until_idx"
  ON "slot_assignments" ("reserved_until");
