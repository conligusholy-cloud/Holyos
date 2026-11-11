-- Číselné řady výrobních čísel strojů po zemích
CREATE TABLE IF NOT EXISTS "production_serial_series" (
  "id" SERIAL NOT NULL,
  "country" VARCHAR(2) NOT NULL,
  "name" VARCHAR(100),
  "format" VARCHAR(100) NOT NULL DEFAULT '{CC}-{N:4}',
  "next_number" INTEGER NOT NULL DEFAULT 1,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "note" TEXT,
  "last_issued_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "production_serial_series_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "production_serial_series_country_active_idx" ON "production_serial_series"("country", "active");
