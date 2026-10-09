-- Servis → Údržba: provedené kontroly (vyplněné kontrolní protokoly)
CREATE TABLE IF NOT EXISTS "maintenance_inspections" (
  "id" SERIAL PRIMARY KEY,
  "checklist_id" INTEGER,
  "checklist_name" VARCHAR(200),
  "machine_id" INTEGER,
  "machine_name" VARCHAR(200),
  "inspector_user_id" INTEGER,
  "inspector_name" VARCHAR(200),
  "inspected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "results" JSONB NOT NULL DEFAULT '[]',
  "overall" VARCHAR(10) NOT NULL DEFAULT 'ok',
  "defects" TEXT,
  "fix_deadline" DATE,
  "note" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "maintenance_inspections_machine_id_idx" ON "maintenance_inspections"("machine_id");
CREATE INDEX IF NOT EXISTS "maintenance_inspections_inspected_at_idx" ON "maintenance_inspections"("inspected_at");
