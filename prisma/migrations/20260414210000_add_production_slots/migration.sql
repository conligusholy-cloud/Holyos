-- Výrobní sloty — časová okna výroby

CREATE TABLE "production_slots" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "workstation_id" INTEGER,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "capacity_hours" DECIMAL(8,2) NOT NULL DEFAULT 8,
    "status" VARCHAR(20) NOT NULL DEFAULT 'open',
    "color" VARCHAR(20) NOT NULL DEFAULT '#3b82f6',
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "production_slots_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "slot_assignments" (
    "id" SERIAL NOT NULL,
    "slot_id" INTEGER NOT NULL,
    "order_id" INTEGER,
    "order_item_id" INTEGER,
    "product_name" VARCHAR(255) NOT NULL,
    "customer_name" VARCHAR(255),
    "quantity" DECIMAL(10,2) NOT NULL DEFAULT 1,
    "estimated_hours" DECIMAL(8,2) NOT NULL DEFAULT 0,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "status" VARCHAR(20) NOT NULL DEFAULT 'planned',
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "slot_assignments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "slot_blocks" (
    "id" SERIAL NOT NULL,
    "slot_id" INTEGER NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "reason" VARCHAR(255) NOT NULL,
    "block_type" VARCHAR(30) NOT NULL DEFAULT 'holiday',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "slot_blocks_pkey" PRIMARY KEY ("id")
);

-- Foreign keys
ALTER TABLE "production_slots" ADD CONSTRAINT "production_slots_workstation_id_fkey" FOREIGN KEY ("workstation_id") REFERENCES "workstations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "slot_assignments" ADD CONSTRAINT "slot_assignments_slot_id_fkey" FOREIGN KEY ("slot_id") REFERENCES "production_slots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "slot_blocks" ADD CONSTRAINT "slot_blocks_slot_id_fkey" FOREIGN KEY ("slot_id") REFERENCES "production_slots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Indexy
CREATE INDEX "production_slots_workstation_id_idx" ON "production_slots"("workstation_id");
CREATE INDEX "production_slots_start_date_idx" ON "production_slots"("start_date");
CREATE INDEX "production_slots_end_date_idx" ON "production_slots"("end_date");
CREATE INDEX "production_slots_status_idx" ON "production_slots"("status");
CREATE INDEX "slot_assignments_slot_id_idx" ON "slot_assignments"("slot_id");
CREATE INDEX "slot_assignments_order_id_idx" ON "slot_assignments"("order_id");
CREATE INDEX "slot_assignments_status_idx" ON "slot_assignments"("status");
CREATE INDEX "slot_blocks_slot_id_idx" ON "slot_blocks"("slot_id");
CREATE INDEX "slot_blocks_start_date_idx" ON "slot_blocks"("start_date");
