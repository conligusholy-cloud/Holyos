-- Týdenní vzorec výrobních slotů s časovou platností
-- SlotScheme drží valid_from / valid_to (NULL = aktuálně platné), SlotSchemeWindow
-- jsou jednotlivá výrobní okna v rámci jednoho schématu (1..N per scheme).
-- Auto-close předchozího schématu při vytvoření nového řeší backend (routes).

CREATE TABLE IF NOT EXISTS "slot_schemes" (
  "id"         SERIAL       PRIMARY KEY,
  "valid_from" DATE         NOT NULL,
  "valid_to"   DATE,
  "note"       VARCHAR(255),
  "created_by" INTEGER,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "slot_scheme_windows" (
  "id"         SERIAL  PRIMARY KEY,
  "scheme_id"  INTEGER NOT NULL,
  "start_day"  INTEGER NOT NULL,
  "end_day"    INTEGER NOT NULL,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "name"       VARCHAR(50)
);

-- FK + indexy (idempotentně přes DO bloček, kvůli Railway resolve)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'slot_schemes_created_by_fkey') THEN
    ALTER TABLE "slot_schemes"
      ADD CONSTRAINT "slot_schemes_created_by_fkey"
      FOREIGN KEY ("created_by") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'slot_scheme_windows_scheme_id_fkey') THEN
    ALTER TABLE "slot_scheme_windows"
      ADD CONSTRAINT "slot_scheme_windows_scheme_id_fkey"
      FOREIGN KEY ("scheme_id") REFERENCES "slot_schemes"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "slot_schemes_valid_from_idx" ON "slot_schemes"("valid_from");
CREATE INDEX IF NOT EXISTS "slot_schemes_valid_to_idx"   ON "slot_schemes"("valid_to");
CREATE INDEX IF NOT EXISTS "slot_scheme_windows_scheme_id_idx" ON "slot_scheme_windows"("scheme_id");
