-- =============================================================================
-- Celozávodní dovolená — ruční hodnota u zaměstnance a roku (požadavek #142)
-- =============================================================================
-- Bez záznamu se počet dní dál počítá z "company_leave". Záznam je výjimka pro
-- konkrétního člověka v konkrétním roce. Tabulka osob je @@map("people").

CREATE TABLE IF NOT EXISTS "company_leave_overrides" (
  "id"         SERIAL PRIMARY KEY,
  "person_id"  INTEGER NOT NULL,
  "year"       INTEGER NOT NULL,
  "days"       INTEGER NOT NULL,
  "updated_by" INTEGER,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "company_leave_overrides_person_id_year_key"
  ON "company_leave_overrides" ("person_id", "year");

CREATE INDEX IF NOT EXISTS "company_leave_overrides_year_idx"
  ON "company_leave_overrides" ("year");

-- Cizí klíč jen když ještě není (ADD CONSTRAINT neumí IF NOT EXISTS).
DO $$
BEGIN
  ALTER TABLE "company_leave_overrides"
    ADD CONSTRAINT "company_leave_overrides_person_id_fkey"
    FOREIGN KEY ("person_id") REFERENCES "people"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
