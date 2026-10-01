-- Skupiny pracovišť (Hala → Skupina → Pracoviště) — zaměnitelná pracoviště se stejnými operacemi
CREATE TABLE IF NOT EXISTS "workstation_groups" (
  "id" SERIAL NOT NULL,
  "name" VARCHAR(255) NOT NULL,
  "code" VARCHAR(50),
  "hall_id" INTEGER,
  "color" VARCHAR(20),
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "note" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "workstation_groups_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "workstation_groups_hall_id_idx" ON "workstation_groups"("hall_id");
DO $$ BEGIN
  ALTER TABLE "workstation_groups" ADD CONSTRAINT "workstation_groups_hall_id_fkey"
    FOREIGN KEY ("hall_id") REFERENCES "halls"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "workstations" ADD COLUMN IF NOT EXISTS "group_id" INTEGER;
CREATE INDEX IF NOT EXISTS "workstations_group_id_idx" ON "workstations"("group_id");
DO $$ BEGIN
  ALTER TABLE "workstations" ADD CONSTRAINT "workstations_group_id_fkey"
    FOREIGN KEY ("group_id") REFERENCES "workstation_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "product_operations" ADD COLUMN IF NOT EXISTS "workstation_group_id" INTEGER;
CREATE INDEX IF NOT EXISTS "product_operations_workstation_group_id_idx" ON "product_operations"("workstation_group_id");
DO $$ BEGIN
  ALTER TABLE "product_operations" ADD CONSTRAINT "product_operations_workstation_group_id_fkey"
    FOREIGN KEY ("workstation_group_id") REFERENCES "workstation_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "batch_operations" ADD COLUMN IF NOT EXISTS "workstation_group_id" INTEGER;
CREATE INDEX IF NOT EXISTS "batch_operations_workstation_group_id_idx" ON "batch_operations"("workstation_group_id");
DO $$ BEGIN
  ALTER TABLE "batch_operations" ADD CONSTRAINT "batch_operations_workstation_group_id_fkey"
    FOREIGN KEY ("workstation_group_id") REFERENCES "workstation_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
