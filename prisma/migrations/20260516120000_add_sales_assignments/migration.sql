-- Migration: add_sales_assignments
-- Modul Obchod — role + přidělování kontaktů jednotlivým obchodníkům
-- s individuální % provizí na úrovni kontakt × obchodník.
--
-- Tabulka:
--   sales_contact_assignments  — M:N kontakt ↔ obchodník (Person)
--
-- Sémantika provize:
--   commission_pct         — aktuální (default) %, mění vedoucí obchodu kdykoliv
--   commission_locked_pct  — uzamčená hodnota v okamžiku, kdy je obchod uzavřen
--                            (objednávka zaplacena). Když je vyplněno, je to
--                            zdrojem pravdy pro výplatu a další změny defaultu
--                            už ho neovlivní.
--   commission_locked_at   — kdy se uzamklo
--
-- Idempotentní (Railway pattern).

CREATE TABLE IF NOT EXISTS "sales_contact_assignments" (
  "id"                    SERIAL PRIMARY KEY,
  "contact_id"            INTEGER NOT NULL,
  "person_id"             INTEGER NOT NULL,
  "commission_pct"        DECIMAL(5, 2),
  "commission_locked_pct" DECIMAL(5, 2),
  "commission_locked_at"  TIMESTAMP(3),
  "assigned_by_id"        INTEGER,
  "created_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- FK na kontakt (cascade delete)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sales_contact_assignments_contact_id_fkey'
  ) THEN
    ALTER TABLE "sales_contact_assignments"
      ADD CONSTRAINT "sales_contact_assignments_contact_id_fkey"
      FOREIGN KEY ("contact_id") REFERENCES "sales_contacts"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- FK na obchodníka (Person, cascade delete — když smažu Person, smaže přidělení)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sales_contact_assignments_person_id_fkey'
  ) THEN
    ALTER TABLE "sales_contact_assignments"
      ADD CONSTRAINT "sales_contact_assignments_person_id_fkey"
      FOREIGN KEY ("person_id") REFERENCES "people"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- FK na autora přidělení (vedoucí / admin, set null pokud zmizí)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sales_contact_assignments_assigned_by_id_fkey'
  ) THEN
    ALTER TABLE "sales_contact_assignments"
      ADD CONSTRAINT "sales_contact_assignments_assigned_by_id_fkey"
      FOREIGN KEY ("assigned_by_id") REFERENCES "people"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Indexy
CREATE INDEX IF NOT EXISTS "sales_contact_assignments_contact_id_idx"
  ON "sales_contact_assignments"("contact_id");
CREATE INDEX IF NOT EXISTS "sales_contact_assignments_person_id_idx"
  ON "sales_contact_assignments"("person_id");

-- Unikátní párování — jeden obchodník je u kontaktu zapsán max. jednou
CREATE UNIQUE INDEX IF NOT EXISTS "sales_contact_assignments_contact_id_person_id_key"
  ON "sales_contact_assignments"("contact_id", "person_id");

-- Bootstrap: pokud byl kontakt už dříve přiřazen přes legacy `assigned_to_id`,
-- pře-zaregistrujeme ho jako standardní assignment (bez provize). Nezruší to
-- původní sloupec — ten zůstává pro zpětnou kompatibilitu.
INSERT INTO "sales_contact_assignments" ("contact_id", "person_id", "created_at", "updated_at")
SELECT sc."id", sc."assigned_to_id", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "sales_contacts" sc
WHERE sc."assigned_to_id" IS NOT NULL
ON CONFLICT ("contact_id", "person_id") DO NOTHING;
