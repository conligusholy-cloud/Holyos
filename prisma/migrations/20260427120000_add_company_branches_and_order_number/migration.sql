-- Vozový park: provozovny firem (více poboček pod jednou firmou) + číslo zakázky
-- + M2N relace pro Místo provedení (jeden servis / výměna může být na více pobočkách).
--
-- Idempotentní — používá IF NOT EXISTS / DO $$ bloky.
-- Také seedem převede stávající Company.branch_* (jediná provozovna) na
-- první row v company_branches, aby se nestratila data.

-- ─── 1. Tabulka company_branches ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "company_branches" (
  "id"             SERIAL PRIMARY KEY,
  "company_id"     INTEGER NOT NULL,
  "name"           VARCHAR(255),
  "address"        VARCHAR(255),
  "city"           VARCHAR(100),
  "zip"            VARCHAR(10),
  "contact_person" VARCHAR(255),
  "phone"          VARCHAR(50),
  "email"          VARCHAR(255),
  "note"           TEXT,
  "active"         BOOLEAN NOT NULL DEFAULT TRUE,
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "company_branches_company_id_idx"
  ON "company_branches"("company_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'company_branches_company_id_fkey'
      AND conrelid = '"company_branches"'::regclass
  ) THEN
    ALTER TABLE "company_branches"
      ADD CONSTRAINT "company_branches_company_id_fkey"
      FOREIGN KEY ("company_id") REFERENCES "companies"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END$$;

-- ─── 2. Seed provozoven z existujících Company.branch_* (idempotentně) ─────
-- Pro každou firmu s vyplněným branch_address vytvořit první CompanyBranch row,
-- pokud ještě žádný neexistuje. Tím nepřijdeme o data při přechodu na M2N.
INSERT INTO "company_branches" ("company_id", "name", "address", "city", "zip", "active")
SELECT
  c."id",
  CASE
    WHEN c."branch_city" IS NOT NULL AND c."branch_city" <> ''
      THEN c."name" || ' — ' || c."branch_city"
    ELSE c."name"
  END,
  c."branch_address",
  c."branch_city",
  c."branch_zip",
  TRUE
FROM "companies" c
WHERE c."branch_address" IS NOT NULL
  AND c."branch_address" <> ''
  AND NOT EXISTS (
    SELECT 1 FROM "company_branches" b WHERE b."company_id" = c."id"
  );

-- ─── 3. order_number na vehicle_services / vehicle_tire_changes ────────────
ALTER TABLE "vehicle_services"     ADD COLUMN IF NOT EXISTS "order_number" VARCHAR(100);
ALTER TABLE "vehicle_tire_changes" ADD COLUMN IF NOT EXISTS "order_number" VARCHAR(100);

-- km_at_service už je na vehicle_services; doplnit také na vehicle_tire_changes
-- (uživatel chce číslo zakázky vedle stavu kilometrů v obou záložkách).
ALTER TABLE "vehicle_tire_changes" ADD COLUMN IF NOT EXISTS "km_at_service" INTEGER;

-- ─── 4. M2N: vehicle_service_locations ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS "vehicle_service_locations" (
  "service_id" INTEGER NOT NULL,
  "branch_id"  INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "vehicle_service_locations_pkey" PRIMARY KEY ("service_id", "branch_id")
);

CREATE INDEX IF NOT EXISTS "vehicle_service_locations_service_id_idx"
  ON "vehicle_service_locations"("service_id");
CREATE INDEX IF NOT EXISTS "vehicle_service_locations_branch_id_idx"
  ON "vehicle_service_locations"("branch_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'vehicle_service_locations_service_id_fkey'
      AND conrelid = '"vehicle_service_locations"'::regclass
  ) THEN
    ALTER TABLE "vehicle_service_locations"
      ADD CONSTRAINT "vehicle_service_locations_service_id_fkey"
      FOREIGN KEY ("service_id") REFERENCES "vehicle_services"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'vehicle_service_locations_branch_id_fkey'
      AND conrelid = '"vehicle_service_locations"'::regclass
  ) THEN
    ALTER TABLE "vehicle_service_locations"
      ADD CONSTRAINT "vehicle_service_locations_branch_id_fkey"
      FOREIGN KEY ("branch_id") REFERENCES "company_branches"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END$$;

-- ─── 5. M2N: vehicle_tire_change_locations ─────────────────────────────────
CREATE TABLE IF NOT EXISTS "vehicle_tire_change_locations" (
  "tire_change_id" INTEGER NOT NULL,
  "branch_id"      INTEGER NOT NULL,
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "vehicle_tire_change_locations_pkey" PRIMARY KEY ("tire_change_id", "branch_id")
);

CREATE INDEX IF NOT EXISTS "vehicle_tire_change_locations_tire_change_id_idx"
  ON "vehicle_tire_change_locations"("tire_change_id");
CREATE INDEX IF NOT EXISTS "vehicle_tire_change_locations_branch_id_idx"
  ON "vehicle_tire_change_locations"("branch_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'vehicle_tire_change_locations_tire_change_id_fkey'
      AND conrelid = '"vehicle_tire_change_locations"'::regclass
  ) THEN
    ALTER TABLE "vehicle_tire_change_locations"
      ADD CONSTRAINT "vehicle_tire_change_locations_tire_change_id_fkey"
      FOREIGN KEY ("tire_change_id") REFERENCES "vehicle_tire_changes"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'vehicle_tire_change_locations_branch_id_fkey'
      AND conrelid = '"vehicle_tire_change_locations"'::regclass
  ) THEN
    ALTER TABLE "vehicle_tire_change_locations"
      ADD CONSTRAINT "vehicle_tire_change_locations_branch_id_fkey"
      FOREIGN KEY ("branch_id") REFERENCES "company_branches"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END$$;
