-- Migration: add_site_development
-- Modul Site Development — řízení expanze prádlomatů (vyhledávání lokalit
-- a pozemků, vyjednávání podmínek, evidence smluv, fotky, katastr).
--
-- Tabulky:
--   sites                — hlavní entita: lokalita / pozemek
--   site_contacts        — kontakty na vlastníky / realitky / úřady
--   site_communications  — historie komunikace (call/email/meeting/note)
--   site_photos          — fotografie lokality (file_path → /app/data/site-photos)
--   site_documents       — smlouvy, nabídky, katastrální výpisy
--
-- Status pipeline:
--   lead → researching → negotiating → contract → operational
--   (boční stavy: rejected, lost)
--
-- Idempotentní — všechny příkazy přežijí opakované spuštění (Railway pattern,
-- viz holyos_prisma_migrate_workflow memory).

-- =====================================================================
-- sites — hlavní entita: potenciální lokalita
-- =====================================================================

CREATE TABLE IF NOT EXISTS "sites" (
  "id"                   SERIAL PRIMARY KEY,
  "name"                 VARCHAR(255) NOT NULL,
  "site_type"            VARCHAR(20)  NOT NULL DEFAULT 'rent',
  "status"               VARCHAR(30)  NOT NULL DEFAULT 'lead',
  "description"          TEXT,

  -- Adresa a poloha
  "address"              VARCHAR(500),
  "city"                 VARCHAR(120),
  "zip"                  VARCHAR(10),
  "country"              VARCHAR(60) DEFAULT 'CZ',
  "latitude"             DECIMAL(10, 7),
  "longitude"            DECIMAL(10, 7),
  "map_link"             TEXT,

  -- Vlastník / pronajímatel (free-text + volitelná vazba na Company)
  "owner_name"           VARCHAR(255),
  "owner_phone"          VARCHAR(40),
  "owner_email"          VARCHAR(255),
  "owner_note"           TEXT,
  "company_id"           INTEGER,

  -- Finanční podmínky
  "rent_monthly"         DECIMAL(12, 2),
  "rent_currency"        VARCHAR(3) DEFAULT 'CZK',
  "deposit"              DECIMAL(12, 2),
  "energy_deposit"       DECIMAL(12, 2),
  "energy_monthly"       DECIMAL(12, 2),
  "other_costs_monthly"  DECIMAL(12, 2),
  "purchase_price"       DECIMAL(14, 2),
  "contract_terms"       TEXT,
  "contract_start"       DATE,
  "contract_end"         DATE,

  -- Prostor / parametry
  "area_m2"              DECIMAL(10, 2),
  "ceiling_height_m"     DECIMAL(5, 2),
  "electricity_kw"       DECIMAL(8, 2),
  "water_supply"         BOOLEAN,
  "sewage"               BOOLEAN,
  "parking"              BOOLEAN,
  "capacity_note"        TEXT,

  -- Katastr
  "cadastral_area"       VARCHAR(255),
  "cadastral_parcel"     VARCHAR(120),
  "cadastral_lv"         VARCHAR(40),
  "cadastral_link"       TEXT,

  -- Vyhodnocení
  "score"                INTEGER,
  "pros"                 TEXT,
  "cons"                 TEXT,
  "rejection_reason"     TEXT,

  -- Přiřazení
  "assigned_to_id"       INTEGER,
  "created_by_id"        INTEGER,
  "pradlomat_ref"        VARCHAR(255),

  "created_at"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "sites_status_idx"          ON "sites" ("status");
CREATE INDEX IF NOT EXISTS "sites_site_type_idx"       ON "sites" ("site_type");
CREATE INDEX IF NOT EXISTS "sites_city_idx"            ON "sites" ("city");
CREATE INDEX IF NOT EXISTS "sites_assigned_to_id_idx"  ON "sites" ("assigned_to_id");
CREATE INDEX IF NOT EXISTS "sites_created_by_id_idx"   ON "sites" ("created_by_id");
CREATE INDEX IF NOT EXISTS "sites_company_id_idx"      ON "sites" ("company_id");
CREATE INDEX IF NOT EXISTS "sites_created_at_idx"      ON "sites" ("created_at");

-- FK vazby (s ON DELETE SET NULL — nechceme ztratit lokalitu kvůli smazání Person/Company)
DO $$ BEGIN
  ALTER TABLE "sites"
    ADD CONSTRAINT "sites_assigned_to_id_fkey"
    FOREIGN KEY ("assigned_to_id") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "sites"
    ADD CONSTRAINT "sites_created_by_id_fkey"
    FOREIGN KEY ("created_by_id") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "sites"
    ADD CONSTRAINT "sites_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =====================================================================
-- site_contacts — kontakty na lokalitu
-- =====================================================================

CREATE TABLE IF NOT EXISTS "site_contacts" (
  "id"         SERIAL PRIMARY KEY,
  "site_id"    INTEGER NOT NULL,
  "name"       VARCHAR(255) NOT NULL,
  "role"       VARCHAR(120),
  "phone"      VARCHAR(40),
  "email"      VARCHAR(255),
  "company"    VARCHAR(255),
  "note"       TEXT,
  "is_primary" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "site_contacts_site_id_idx"    ON "site_contacts" ("site_id");
CREATE INDEX IF NOT EXISTS "site_contacts_is_primary_idx" ON "site_contacts" ("is_primary");

DO $$ BEGIN
  ALTER TABLE "site_contacts"
    ADD CONSTRAINT "site_contacts_site_id_fkey"
    FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =====================================================================
-- site_communications — historie komunikace
-- =====================================================================

CREATE TABLE IF NOT EXISTS "site_communications" (
  "id"            SERIAL PRIMARY KEY,
  "site_id"       INTEGER NOT NULL,
  "channel"       VARCHAR(20) NOT NULL DEFAULT 'note',
  "subject"       VARCHAR(500),
  "body"          TEXT NOT NULL,
  "occurred_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "author_id"     INTEGER,
  "followup_at"   TIMESTAMP(3),
  "followup_done" BOOLEAN NOT NULL DEFAULT false,
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "site_communications_site_id_idx"     ON "site_communications" ("site_id");
CREATE INDEX IF NOT EXISTS "site_communications_occurred_at_idx" ON "site_communications" ("occurred_at");
CREATE INDEX IF NOT EXISTS "site_communications_followup_at_idx" ON "site_communications" ("followup_at");
CREATE INDEX IF NOT EXISTS "site_communications_channel_idx"     ON "site_communications" ("channel");

DO $$ BEGIN
  ALTER TABLE "site_communications"
    ADD CONSTRAINT "site_communications_site_id_fkey"
    FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "site_communications"
    ADD CONSTRAINT "site_communications_author_id_fkey"
    FOREIGN KEY ("author_id") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =====================================================================
-- site_photos — fotografie lokality
-- =====================================================================

CREATE TABLE IF NOT EXISTS "site_photos" (
  "id"         SERIAL PRIMARY KEY,
  "site_id"    INTEGER NOT NULL,
  "file_path"  VARCHAR(500) NOT NULL,
  "url"        VARCHAR(500),
  "caption"    VARCHAR(500),
  "mime_type"  VARCHAR(80),
  "size_bytes" INTEGER,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "site_photos_site_id_idx"    ON "site_photos" ("site_id");
CREATE INDEX IF NOT EXISTS "site_photos_sort_order_idx" ON "site_photos" ("sort_order");

DO $$ BEGIN
  ALTER TABLE "site_photos"
    ADD CONSTRAINT "site_photos_site_id_fkey"
    FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =====================================================================
-- site_documents — smlouvy a další dokumenty
-- =====================================================================

CREATE TABLE IF NOT EXISTS "site_documents" (
  "id"           SERIAL PRIMARY KEY,
  "site_id"      INTEGER NOT NULL,
  "doc_type"     VARCHAR(30) NOT NULL DEFAULT 'other',
  "title"        VARCHAR(500) NOT NULL,
  "file_path"    VARCHAR(500),
  "external_url" TEXT,
  "size_bytes"   INTEGER,
  "mime_type"    VARCHAR(80),
  "note"         TEXT,
  "signed_at"    TIMESTAMP(3),
  "valid_from"   TIMESTAMP(3),
  "valid_to"     TIMESTAMP(3),
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "site_documents_site_id_idx"  ON "site_documents" ("site_id");
CREATE INDEX IF NOT EXISTS "site_documents_doc_type_idx" ON "site_documents" ("doc_type");

DO $$ BEGIN
  ALTER TABLE "site_documents"
    ADD CONSTRAINT "site_documents_site_id_fkey"
    FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
