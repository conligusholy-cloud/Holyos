-- Kdo smí operaci dělat (varianty pro plánovač)
CREATE TABLE IF NOT EXISTS "operation_allowed_people" (
  "id" SERIAL NOT NULL,
  "operation_id" INTEGER NOT NULL,
  "person_id" INTEGER NOT NULL,
  "priority" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "operation_allowed_people_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "operation_allowed_people_operation_id_person_id_key" ON "operation_allowed_people"("operation_id", "person_id");
CREATE INDEX IF NOT EXISTS "operation_allowed_people_person_id_idx" ON "operation_allowed_people"("person_id");
DO $$ BEGIN
  ALTER TABLE "operation_allowed_people" ADD CONSTRAINT "operation_allowed_people_operation_id_fkey" FOREIGN KEY ("operation_id") REFERENCES "product_operations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "operation_allowed_people" ADD CONSTRAINT "operation_allowed_people_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
