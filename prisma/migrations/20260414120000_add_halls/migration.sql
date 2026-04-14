-- Vytvoření tabulky hal pro seskupení pracovišť
CREATE TABLE "halls" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "color" VARCHAR(20) NOT NULL DEFAULT '#14b8a6',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "halls_pkey" PRIMARY KEY ("id")
);

-- Přidání vazby pracoviště na halu
ALTER TABLE "workstations" ADD COLUMN "hall_id" INTEGER;

-- Index na hall_id
CREATE INDEX "workstations_hall_id_idx" ON "workstations"("hall_id");

-- FK constraint
ALTER TABLE "workstations" ADD CONSTRAINT "workstations_hall_id_fkey" FOREIGN KEY ("hall_id") REFERENCES "halls"("id") ON DELETE SET NULL ON UPDATE CASCADE;
