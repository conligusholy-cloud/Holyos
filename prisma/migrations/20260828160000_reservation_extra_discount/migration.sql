-- Dodatečná sleva (%) na kupní cenu u rezervace — promítne se do smluv.
ALTER TABLE "location_reservations" ADD COLUMN IF NOT EXISTS "extra_discount_pct" DOUBLE PRECISION;
