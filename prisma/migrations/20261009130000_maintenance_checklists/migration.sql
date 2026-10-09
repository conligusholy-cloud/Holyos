-- Servis → Údržba: šablony kontrolních protokolů (checklist)
CREATE TABLE IF NOT EXISTS "maintenance_checklists" (
  "id" SERIAL PRIMARY KEY,
  "name" VARCHAR(200) NOT NULL,
  "description" TEXT,
  "items" JSONB NOT NULL DEFAULT '[]',
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL
);
