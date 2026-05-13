-- Migration: add_sales_module
-- Modul Obchod — Sales CRM pro obchodníka prádelen.
--
-- Tabulky:
--   sales_contacts        — potenciální klienti / leady (manual + FB/IG/LinkedIn webhooky)
--   sales_contact_notes   — časová osa komunikace
--   sales_events          — kalendář (schůzky, hovory, demo, follow-up)
--
-- Status flow: new → contacted → qualified → meeting → proposal → won | lost
-- "won" převede SalesContact na Company (converted_company_id) a odemkne
-- standardní vytváření Order.
--
-- Idempotentní — všechny příkazy přežijí opakované spuštění (Railway pattern,
-- viz holyos_prisma_migrate_workflow memory).

-- =====================================================================
-- sales_contacts — lead / potenciální zákazník
-- =====================================================================

CREATE TABLE IF NOT EXISTS "sales_contacts" (
  "id"                   SERIAL PRIMARY KEY,
  "first_name"           VARCHAR(255) NOT NULL,
  "last_name"            VARCHAR(255),
  "email"                VARCHAR(255),
  "phone"                VARCHAR(50),
  "company_name"         VARCHAR(255),
  "position"             VARCHAR(255),
  "web"                  VARCHAR(500),
  "address"              VARCHAR(255),
  "city"                 VARCHAR(100),
  "zip"                  VARCHAR(10),
  "source"               VARCHAR(50) NOT NULL DEFAULT 'manual',
  "source_detail"        VARCHAR(255),
  "status"               VARCHAR(30) NOT NULL DEFAULT 'new',
  "potential"            VARCHAR(20) NOT NULL DEFAULT 'medium',
  "expected_value"       DECIMAL(12, 2),
  "next_action_at"       TIMESTAMP(3),
  "notes"                TEXT,
  "assigned_to_id"       INTEGER,
  "converted_company_id" INTEGER,
  "converted_at"         TIMESTAMP(3),
  "meta_lead_id"         VARCHAR(255),
  "meta_form_id"         VARCHAR(255),
  "meta_page_id"         VARCHAR(255),
  "meta_ad_id"           VARCHAR(255),
  "meta_raw"             JSONB,
  "linkedin_id"          VARCHAR(255),
  "linkedin_url"         VARCHAR(500),
  "created_at"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "sales_contacts_meta_lead_id_key" ON "sales_contacts" ("meta_lead_id");
CREATE INDEX IF NOT EXISTS "sales_contacts_status_idx"               ON "sales_contacts" ("status");
CREATE INDEX IF NOT EXISTS "sales_contacts_source_idx"               ON "sales_contacts" ("source");
CREATE INDEX IF NOT EXISTS "sales_contacts_potential_idx"            ON "sales_contacts" ("potential");
CREATE INDEX IF NOT EXISTS "sales_contacts_assigned_to_id_idx"       ON "sales_contacts" ("assigned_to_id");
CREATE INDEX IF NOT EXISTS "sales_contacts_converted_company_id_idx" ON "sales_contacts" ("converted_company_id");
CREATE INDEX IF NOT EXISTS "sales_contacts_next_action_at_idx"       ON "sales_contacts" ("next_action_at");

-- FK sales_contacts.assigned_to_id → people.id
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_contacts_assigned_to_id_fkey') THEN
    ALTER TABLE "sales_contacts"
      ADD CONSTRAINT "sales_contacts_assigned_to_id_fkey"
      FOREIGN KEY ("assigned_to_id") REFERENCES "people"("id") ON DELETE SET NULL;
  END IF;
END $$;

-- FK sales_contacts.converted_company_id → companies.id
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_contacts_converted_company_id_fkey') THEN
    ALTER TABLE "sales_contacts"
      ADD CONSTRAINT "sales_contacts_converted_company_id_fkey"
      FOREIGN KEY ("converted_company_id") REFERENCES "companies"("id") ON DELETE SET NULL;
  END IF;
END $$;

-- =====================================================================
-- sales_contact_notes — časová osa komunikace
-- =====================================================================

CREATE TABLE IF NOT EXISTS "sales_contact_notes" (
  "id"         SERIAL PRIMARY KEY,
  "contact_id" INTEGER NOT NULL,
  "author_id"  INTEGER,
  "kind"       VARCHAR(30) NOT NULL DEFAULT 'note',
  "content"    TEXT NOT NULL,
  "old_status" VARCHAR(30),
  "new_status" VARCHAR(30),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "sales_contact_notes_contact_id_idx" ON "sales_contact_notes" ("contact_id");
CREATE INDEX IF NOT EXISTS "sales_contact_notes_author_id_idx"  ON "sales_contact_notes" ("author_id");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_contact_notes_contact_id_fkey') THEN
    ALTER TABLE "sales_contact_notes"
      ADD CONSTRAINT "sales_contact_notes_contact_id_fkey"
      FOREIGN KEY ("contact_id") REFERENCES "sales_contacts"("id") ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_contact_notes_author_id_fkey') THEN
    ALTER TABLE "sales_contact_notes"
      ADD CONSTRAINT "sales_contact_notes_author_id_fkey"
      FOREIGN KEY ("author_id") REFERENCES "people"("id") ON DELETE SET NULL;
  END IF;
END $$;

-- =====================================================================
-- sales_events — kalendář schůzek, hovorů, demo, follow-up
-- =====================================================================

CREATE TABLE IF NOT EXISTS "sales_events" (
  "id"           SERIAL PRIMARY KEY,
  "contact_id"   INTEGER,
  "organizer_id" INTEGER,
  "title"        VARCHAR(500) NOT NULL,
  "description"  TEXT,
  "event_type"   VARCHAR(30) NOT NULL DEFAULT 'meeting',
  "location"     VARCHAR(500),
  "start_at"     TIMESTAMP(3) NOT NULL,
  "end_at"       TIMESTAMP(3),
  "all_day"      BOOLEAN NOT NULL DEFAULT FALSE,
  "status"       VARCHAR(20) NOT NULL DEFAULT 'planned',
  "reminder_min" INTEGER,
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "sales_events_contact_id_idx"   ON "sales_events" ("contact_id");
CREATE INDEX IF NOT EXISTS "sales_events_organizer_id_idx" ON "sales_events" ("organizer_id");
CREATE INDEX IF NOT EXISTS "sales_events_start_at_idx"     ON "sales_events" ("start_at");
CREATE INDEX IF NOT EXISTS "sales_events_status_idx"       ON "sales_events" ("status");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_events_contact_id_fkey') THEN
    ALTER TABLE "sales_events"
      ADD CONSTRAINT "sales_events_contact_id_fkey"
      FOREIGN KEY ("contact_id") REFERENCES "sales_contacts"("id") ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_events_organizer_id_fkey') THEN
    ALTER TABLE "sales_events"
      ADD CONSTRAINT "sales_events_organizer_id_fkey"
      FOREIGN KEY ("organizer_id") REFERENCES "people"("id") ON DELETE SET NULL;
  END IF;
END $$;
