-- Odhad času cesty ze základny ke stroji (min) — počítá se při vytvoření požadavku.
ALTER TABLE "service_requests" ADD COLUMN "est_travel_min" INTEGER;
