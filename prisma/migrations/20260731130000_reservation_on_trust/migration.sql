-- HolyOS — Rezervace „na důvěru" (bez smlouvy) u LocationReservation
-- Idempotentní, aby bezpečně proběhla i při částečně aplikovaném stavu na Railway.
ALTER TABLE "location_reservations" ADD COLUMN IF NOT EXISTS "on_trust" BOOLEAN NOT NULL DEFAULT false;
