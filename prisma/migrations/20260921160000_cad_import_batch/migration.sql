-- Protokol CAD importů — co konkrétní běh importu provedl
CREATE TABLE IF NOT EXISTS "cad_import_batches" (
  "id"                SERIAL PRIMARY KEY,
  "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "source"            VARCHAR(50),
  "author"            VARCHAR(160),
  "project_label"     VARCHAR(255),
  "success"           BOOLEAN NOT NULL DEFAULT true,
  "count_files"       INTEGER NOT NULL DEFAULT 0,
  "count_created"     INTEGER NOT NULL DEFAULT 0,
  "count_updated"     INTEGER NOT NULL DEFAULT 0,
  "count_not_changed" INTEGER NOT NULL DEFAULT 0,
  "count_errors"      INTEGER NOT NULL DEFAULT 0,
  "details"           JSONB
);
CREATE INDEX IF NOT EXISTS "cad_import_batches_created_at_idx" ON "cad_import_batches"("created_at");
