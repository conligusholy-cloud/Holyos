-- Slíbeno s místem: lokalita, termín a značka odeslaného upozornění
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "location_promised" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "location_search_area" VARCHAR(255);
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "location_search_deadline" DATE;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "location_notified_at" TIMESTAMP(3);
