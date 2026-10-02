-- Více lidí na jedné operaci dávky
CREATE TABLE IF NOT EXISTS "batch_operation_workers" (
  "id" SERIAL NOT NULL,
  "batch_operation_id" INTEGER NOT NULL,
  "person_id" INTEGER NOT NULL,
  "slot" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "batch_operation_workers_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "batch_operation_workers_batch_operation_id_person_id_key" ON "batch_operation_workers"("batch_operation_id", "person_id");
CREATE INDEX IF NOT EXISTS "batch_operation_workers_person_id_idx" ON "batch_operation_workers"("person_id");
DO $$ BEGIN
  ALTER TABLE "batch_operation_workers" ADD CONSTRAINT "batch_operation_workers_batch_operation_id_fkey" FOREIGN KEY ("batch_operation_id") REFERENCES "batch_operations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "batch_operation_workers" ADD CONSTRAINT "batch_operation_workers_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
