-- Migration: add_service_appliance_manuals
-- PDF manuály výrobců přiložené ke ServiceAppliance.
-- Při uploadu extrahujeme text (pdf-parse) a uložíme do extracted_text —
-- Hugo z toho pak čerpá při RAG retrievalu (ILIKE search nad textem).
-- Soubor sám se ukládá do data/service-manuals/<appliance_id>/ na Railway persistent volume.

CREATE TABLE IF NOT EXISTS "service_appliance_manuals" (
  "id"             SERIAL PRIMARY KEY,
  "appliance_id"   INTEGER NOT NULL,
  "title"          VARCHAR(500) NOT NULL,
  "file_path"      VARCHAR(500) NOT NULL,
  "mime_type"      VARCHAR(80),
  "size_bytes"     INTEGER,
  "page_count"     INTEGER,
  "language"       VARCHAR(5),
  "extracted_text" TEXT,
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "service_appliance_manuals_appliance_id_fkey" FOREIGN KEY ("appliance_id")
    REFERENCES "service_appliances"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "service_appliance_manuals_appliance_id_idx"
  ON "service_appliance_manuals"("appliance_id");

-- Trigram index nad extrahovaným textem pro rychlý ILIKE fulltext search.
-- pg_trgm extenze už byla vytvořena v migraci add_service_module_hugo.
CREATE INDEX IF NOT EXISTS "service_appliance_manuals_text_trgm_idx"
  ON "service_appliance_manuals" USING gin (extracted_text gin_trgm_ops);
