-- Předjednaná místa pro prádlomat (veřejný přehled pradlomaty.info/location)
-- Samostatný koncept, oddělený od tabulky sites.

CREATE TABLE IF NOT EXISTS "pradlomat_spots" (
  "id" SERIAL PRIMARY KEY,
  "code" VARCHAR(80) NOT NULL,
  "title" VARCHAR(255) NOT NULL,
  "status" VARCHAR(20) NOT NULL DEFAULT 'draft',
  "is_public" BOOLEAN NOT NULL DEFAULT false,
  "city" VARCHAR(120),
  "region" VARCHAR(120),
  "country" VARCHAR(60) DEFAULT 'CZ',
  "address" VARCHAR(500),
  "show_address" BOOLEAN NOT NULL DEFAULT false,
  "latitude" DECIMAL(10,7),
  "longitude" DECIMAL(10,7),
  "public_description" TEXT,
  "highlight" VARCHAR(160),
  "area_m2" DECIMAL(10,2),
  "rent_monthly" DECIMAL(12,2),
  "rent_currency" VARCHAR(3) DEFAULT 'CZK',
  "footfall_note" VARCHAR(255),
  "availability_note" VARCHAR(255),
  "cover_image_url" VARCHAR(500),
  "gallery" JSONB,
  "owner_name" VARCHAR(255),
  "owner_phone" VARCHAR(40),
  "owner_email" VARCHAR(255),
  "internal_notes" TEXT,
  "electricity_kw" DECIMAL(8,2),
  "water_supply" BOOLEAN,
  "sewage" BOOLEAN,
  "assigned_to_id" INTEGER,
  "created_by_id" INTEGER,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "pradlomat_spots_code_key" ON "pradlomat_spots" ("code");
CREATE INDEX IF NOT EXISTS "pradlomat_spots_status_idx" ON "pradlomat_spots" ("status");
CREATE INDEX IF NOT EXISTS "pradlomat_spots_is_public_idx" ON "pradlomat_spots" ("is_public");
CREATE INDEX IF NOT EXISTS "pradlomat_spots_city_idx" ON "pradlomat_spots" ("city");
CREATE INDEX IF NOT EXISTS "pradlomat_spots_sort_order_idx" ON "pradlomat_spots" ("sort_order");
CREATE INDEX IF NOT EXISTS "pradlomat_spots_assigned_to_id_idx" ON "pradlomat_spots" ("assigned_to_id");

CREATE TABLE IF NOT EXISTS "pradlomat_spot_inquiries" (
  "id" SERIAL PRIMARY KEY,
  "spot_id" INTEGER NOT NULL,
  "name" VARCHAR(255),
  "phone" VARCHAR(40),
  "email" VARCHAR(255),
  "message" TEXT,
  "status" VARCHAR(20) NOT NULL DEFAULT 'new',
  "source" VARCHAR(60),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "pradlomat_spot_inquiries_spot_id_idx" ON "pradlomat_spot_inquiries" ("spot_id");
CREATE INDEX IF NOT EXISTS "pradlomat_spot_inquiries_status_idx" ON "pradlomat_spot_inquiries" ("status");
CREATE INDEX IF NOT EXISTS "pradlomat_spot_inquiries_created_at_idx" ON "pradlomat_spot_inquiries" ("created_at");

DO $$ BEGIN
  ALTER TABLE "pradlomat_spot_inquiries"
    ADD CONSTRAINT "pradlomat_spot_inquiries_spot_id_fkey"
    FOREIGN KEY ("spot_id") REFERENCES "pradlomat_spots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
