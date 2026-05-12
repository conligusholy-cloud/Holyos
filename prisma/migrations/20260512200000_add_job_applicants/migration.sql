-- Migration: add_job_applicants
-- Náborový modul — evidence uchazečů o práci (job_applicants) + časová osa
-- komunikace (applicant_notes). Zdroje: manuální, Facebook Lead Ads webhook,
-- referral, web. Status flow: new → contacted → interview → offer → hired/rejected
--
-- Idempotentní: všechny příkazy lze opakovat bez selhání. FK constrainty jsou
-- v DO blocích, protože PostgreSQL nepodporuje ADD CONSTRAINT IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS "job_applicants" (
  "id"                  SERIAL PRIMARY KEY,
  "first_name"          VARCHAR(255) NOT NULL,
  "last_name"           VARCHAR(255),
  "email"               VARCHAR(255),
  "phone"               VARCHAR(50),
  "position"            VARCHAR(255),
  "cv_data"             TEXT,
  "cv_filename"         VARCHAR(255),
  "cv_mime"             VARCHAR(100),
  "source"              VARCHAR(50) NOT NULL DEFAULT 'manual',
  "source_detail"       VARCHAR(255),
  "status"              VARCHAR(30) NOT NULL DEFAULT 'new',
  "notes"               TEXT,
  "assigned_to_id"      INTEGER,
  "converted_person_id" INTEGER,
  "converted_at"        TIMESTAMP(3),
  "meta_lead_id"        VARCHAR(255),
  "meta_form_id"        VARCHAR(255),
  "meta_page_id"        VARCHAR(255),
  "meta_ad_id"          VARCHAR(255),
  "meta_raw"            JSONB,
  "created_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "job_applicants_converted_person_id_key" ON "job_applicants" ("converted_person_id");
CREATE UNIQUE INDEX IF NOT EXISTS "job_applicants_meta_lead_id_key"        ON "job_applicants" ("meta_lead_id");
CREATE INDEX IF NOT EXISTS "job_applicants_status_idx"          ON "job_applicants" ("status");
CREATE INDEX IF NOT EXISTS "job_applicants_source_idx"          ON "job_applicants" ("source");
CREATE INDEX IF NOT EXISTS "job_applicants_assigned_to_id_idx"  ON "job_applicants" ("assigned_to_id");

-- FK job_applicants.assigned_to_id → people.id
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'job_applicants_assigned_to_id_fkey') THEN
    ALTER TABLE "job_applicants"
      ADD CONSTRAINT "job_applicants_assigned_to_id_fkey"
      FOREIGN KEY ("assigned_to_id") REFERENCES "people"("id") ON DELETE SET NULL;
  END IF;
END $$;

-- FK job_applicants.converted_person_id → people.id
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'job_applicants_converted_person_id_fkey') THEN
    ALTER TABLE "job_applicants"
      ADD CONSTRAINT "job_applicants_converted_person_id_fkey"
      FOREIGN KEY ("converted_person_id") REFERENCES "people"("id") ON DELETE SET NULL;
  END IF;
END $$;

-- =====================================================================
-- applicant_notes — časová osa komunikace
-- =====================================================================

CREATE TABLE IF NOT EXISTS "applicant_notes" (
  "id"           SERIAL PRIMARY KEY,
  "applicant_id" INTEGER NOT NULL,
  "author_id"    INTEGER,
  "kind"         VARCHAR(30) NOT NULL DEFAULT 'note',
  "content"      TEXT NOT NULL,
  "old_status"   VARCHAR(30),
  "new_status"   VARCHAR(30),
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "applicant_notes_applicant_id_idx" ON "applicant_notes" ("applicant_id");
CREATE INDEX IF NOT EXISTS "applicant_notes_author_id_idx"    ON "applicant_notes" ("author_id");

-- FK applicant_notes.applicant_id → job_applicants.id (CASCADE)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'applicant_notes_applicant_id_fkey') THEN
    ALTER TABLE "applicant_notes"
      ADD CONSTRAINT "applicant_notes_applicant_id_fkey"
      FOREIGN KEY ("applicant_id") REFERENCES "job_applicants"("id") ON DELETE CASCADE;
  END IF;
END $$;

-- FK applicant_notes.author_id → people.id
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'applicant_notes_author_id_fkey') THEN
    ALTER TABLE "applicant_notes"
      ADD CONSTRAINT "applicant_notes_author_id_fkey"
      FOREIGN KEY ("author_id") REFERENCES "people"("id") ON DELETE SET NULL;
  END IF;
END $$;
