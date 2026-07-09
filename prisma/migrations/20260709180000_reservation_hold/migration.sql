-- Fáze HOLD rezervace lokality: 1h blokace po kliknutí (hold_until), stav 'hold'.
ALTER TABLE "location_reservations" ADD COLUMN "hold_until" TIMESTAMP(3);
