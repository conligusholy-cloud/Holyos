-- Rozměry pracoviště
ALTER TABLE "workstations" ADD COLUMN "width_m" DECIMAL(8,2);
ALTER TABLE "workstations" ADD COLUMN "length_m" DECIMAL(8,2);

-- Vazební tabulka: pracovníci přiřazení k pracovišti
CREATE TABLE "workstation_workers" (
    "id" SERIAL NOT NULL,
    "workstation_id" INTEGER NOT NULL,
    "person_id" INTEGER NOT NULL,
    "role" VARCHAR(100),
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workstation_workers_pkey" PRIMARY KEY ("id")
);

-- Unikátní index: jeden pracovník na jedno pracoviště
CREATE UNIQUE INDEX "workstation_workers_workstation_id_person_id_key" ON "workstation_workers"("workstation_id", "person_id");
CREATE INDEX "workstation_workers_person_id_idx" ON "workstation_workers"("person_id");

-- FK
ALTER TABLE "workstation_workers" ADD CONSTRAINT "workstation_workers_workstation_id_fkey" FOREIGN KEY ("workstation_id") REFERENCES "workstations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "workstation_workers" ADD CONSTRAINT "workstation_workers_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id") ON DELETE CASCADE ON UPDATE CASCADE;
