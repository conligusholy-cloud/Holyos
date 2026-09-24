-- Leasingové / financující společnosti
CREATE TABLE IF NOT EXISTS "leasing_companies" (
  "id" SERIAL PRIMARY KEY,
  "name" VARCHAR(255) NOT NULL,
  "ico" VARCHAR(20),
  "dic" VARCHAR(20),
  "address" VARCHAR(255),
  "city" VARCHAR(120),
  "zip" VARCHAR(20),
  "country" VARCHAR(4) DEFAULT 'CZ',
  "contact_name" VARCHAR(255),
  "phone" VARCHAR(40),
  "email" VARCHAR(255),
  "note" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "leasing_companies_active_idx" ON "leasing_companies" ("active");
CREATE INDEX IF NOT EXISTS "leasing_companies_name_idx" ON "leasing_companies" ("name");
