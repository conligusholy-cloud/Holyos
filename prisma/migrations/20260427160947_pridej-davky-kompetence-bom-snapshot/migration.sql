-- AlterTable
ALTER TABLE "company_branches" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "product_operations" ADD COLUMN     "from_factorify" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "last_calibrated_at" TIMESTAMP(3),
ADD COLUMN     "last_calibrated_by_id" INTEGER;

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "batch_size_step" INTEGER,
ADD COLUMN     "economic_batch_size" INTEGER,
ADD COLUMN     "min_batch_size" INTEGER;

-- AlterTable
ALTER TABLE "slot_assignments" ADD COLUMN     "batch_id" INTEGER;

-- AlterTable
ALTER TABLE "workstations" ADD COLUMN     "flow_type" VARCHAR(20) NOT NULL DEFAULT 'batch';

-- CreateTable
CREATE TABLE "competencies" (
    "id" SERIAL NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "category" VARCHAR(50),
    "description" TEXT,
    "level_max" INTEGER NOT NULL DEFAULT 3,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "competencies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "worker_competencies" (
    "id" SERIAL NOT NULL,
    "person_id" INTEGER NOT NULL,
    "competency_id" INTEGER NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 1,
    "certified_at" DATE,
    "valid_until" DATE,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "worker_competencies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operation_required_competencies" (
    "id" SERIAL NOT NULL,
    "operation_id" INTEGER NOT NULL,
    "competency_id" INTEGER NOT NULL,
    "min_level" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "operation_required_competencies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bom_snapshots" (
    "id" SERIAL NOT NULL,
    "product_id" INTEGER NOT NULL,
    "variant_key" VARCHAR(255),
    "snapshot_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" VARCHAR(30) NOT NULL DEFAULT 'computed',
    "source_ref" VARCHAR(255),
    "note" TEXT,

    CONSTRAINT "bom_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bom_snapshot_items" (
    "id" SERIAL NOT NULL,
    "snapshot_id" INTEGER NOT NULL,
    "material_id" INTEGER NOT NULL,
    "source_operation_id" INTEGER,
    "quantity" DECIMAL(12,4) NOT NULL,
    "unit" VARCHAR(20) NOT NULL DEFAULT 'ks',
    "depth" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "bom_snapshot_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_batches" (
    "id" SERIAL NOT NULL,
    "batch_number" VARCHAR(50) NOT NULL,
    "product_id" INTEGER NOT NULL,
    "variant_key" VARCHAR(255),
    "quantity" INTEGER NOT NULL,
    "batch_type" VARCHAR(20) NOT NULL DEFAULT 'main',
    "status" VARCHAR(20) NOT NULL DEFAULT 'planned',
    "priority" INTEGER NOT NULL DEFAULT 100,
    "planned_start" TIMESTAMP(3),
    "planned_end" TIMESTAMP(3),
    "actual_start" TIMESTAMP(3),
    "actual_end" TIMESTAMP(3),
    "parent_batch_id" INTEGER,
    "bom_snapshot_id" INTEGER,
    "created_by_id" INTEGER,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "production_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "batch_operations" (
    "id" SERIAL NOT NULL,
    "batch_id" INTEGER NOT NULL,
    "operation_id" INTEGER NOT NULL,
    "workstation_id" INTEGER,
    "sequence" INTEGER NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "planned_start" TIMESTAMP(3),
    "planned_end" TIMESTAMP(3),
    "assigned_person_id" INTEGER,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "duration_minutes" INTEGER,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "batch_operations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "batch_operation_logs" (
    "id" SERIAL NOT NULL,
    "batch_operation_id" INTEGER NOT NULL,
    "person_id" INTEGER,
    "action" VARCHAR(30) NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "batch_operation_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "competencies_code_key" ON "competencies"("code");

-- CreateIndex
CREATE INDEX "competencies_category_idx" ON "competencies"("category");

-- CreateIndex
CREATE INDEX "competencies_active_idx" ON "competencies"("active");

-- CreateIndex
CREATE INDEX "worker_competencies_competency_id_idx" ON "worker_competencies"("competency_id");

-- CreateIndex
CREATE UNIQUE INDEX "worker_competencies_person_id_competency_id_key" ON "worker_competencies"("person_id", "competency_id");

-- CreateIndex
CREATE INDEX "operation_required_competencies_competency_id_idx" ON "operation_required_competencies"("competency_id");

-- CreateIndex
CREATE UNIQUE INDEX "operation_required_competencies_operation_id_competency_id_key" ON "operation_required_competencies"("operation_id", "competency_id");

-- CreateIndex
CREATE INDEX "bom_snapshots_product_id_idx" ON "bom_snapshots"("product_id");

-- CreateIndex
CREATE INDEX "bom_snapshots_snapshot_at_idx" ON "bom_snapshots"("snapshot_at");

-- CreateIndex
CREATE INDEX "bom_snapshot_items_snapshot_id_idx" ON "bom_snapshot_items"("snapshot_id");

-- CreateIndex
CREATE INDEX "bom_snapshot_items_material_id_idx" ON "bom_snapshot_items"("material_id");

-- CreateIndex
CREATE INDEX "bom_snapshot_items_source_operation_id_idx" ON "bom_snapshot_items"("source_operation_id");

-- CreateIndex
CREATE UNIQUE INDEX "production_batches_batch_number_key" ON "production_batches"("batch_number");

-- CreateIndex
CREATE INDEX "production_batches_product_id_idx" ON "production_batches"("product_id");

-- CreateIndex
CREATE INDEX "production_batches_status_idx" ON "production_batches"("status");

-- CreateIndex
CREATE INDEX "production_batches_batch_type_idx" ON "production_batches"("batch_type");

-- CreateIndex
CREATE INDEX "production_batches_planned_start_idx" ON "production_batches"("planned_start");

-- CreateIndex
CREATE INDEX "production_batches_parent_batch_id_idx" ON "production_batches"("parent_batch_id");

-- CreateIndex
CREATE INDEX "production_batches_bom_snapshot_id_idx" ON "production_batches"("bom_snapshot_id");

-- CreateIndex
CREATE INDEX "batch_operations_batch_id_idx" ON "batch_operations"("batch_id");

-- CreateIndex
CREATE INDEX "batch_operations_operation_id_idx" ON "batch_operations"("operation_id");

-- CreateIndex
CREATE INDEX "batch_operations_workstation_id_idx" ON "batch_operations"("workstation_id");

-- CreateIndex
CREATE INDEX "batch_operations_status_idx" ON "batch_operations"("status");

-- CreateIndex
CREATE INDEX "batch_operations_assigned_person_id_idx" ON "batch_operations"("assigned_person_id");

-- CreateIndex
CREATE INDEX "batch_operation_logs_batch_operation_id_idx" ON "batch_operation_logs"("batch_operation_id");

-- CreateIndex
CREATE INDEX "batch_operation_logs_person_id_idx" ON "batch_operation_logs"("person_id");

-- CreateIndex
CREATE INDEX "batch_operation_logs_action_idx" ON "batch_operation_logs"("action");

-- CreateIndex
CREATE INDEX "batch_operation_logs_created_at_idx" ON "batch_operation_logs"("created_at");

-- CreateIndex
CREATE INDEX "slot_assignments_batch_id_idx" ON "slot_assignments"("batch_id");

-- AddForeignKey
ALTER TABLE "product_operations" ADD CONSTRAINT "product_operations_last_calibrated_by_id_fkey" FOREIGN KEY ("last_calibrated_by_id") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slot_assignments" ADD CONSTRAINT "slot_assignments_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "production_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "worker_competencies" ADD CONSTRAINT "worker_competencies_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "worker_competencies" ADD CONSTRAINT "worker_competencies_competency_id_fkey" FOREIGN KEY ("competency_id") REFERENCES "competencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operation_required_competencies" ADD CONSTRAINT "operation_required_competencies_operation_id_fkey" FOREIGN KEY ("operation_id") REFERENCES "product_operations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operation_required_competencies" ADD CONSTRAINT "operation_required_competencies_competency_id_fkey" FOREIGN KEY ("competency_id") REFERENCES "competencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bom_snapshots" ADD CONSTRAINT "bom_snapshots_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bom_snapshot_items" ADD CONSTRAINT "bom_snapshot_items_snapshot_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "bom_snapshots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bom_snapshot_items" ADD CONSTRAINT "bom_snapshot_items_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bom_snapshot_items" ADD CONSTRAINT "bom_snapshot_items_source_operation_id_fkey" FOREIGN KEY ("source_operation_id") REFERENCES "product_operations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_batches" ADD CONSTRAINT "production_batches_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_batches" ADD CONSTRAINT "production_batches_parent_batch_id_fkey" FOREIGN KEY ("parent_batch_id") REFERENCES "production_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_batches" ADD CONSTRAINT "production_batches_bom_snapshot_id_fkey" FOREIGN KEY ("bom_snapshot_id") REFERENCES "bom_snapshots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_batches" ADD CONSTRAINT "production_batches_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch_operations" ADD CONSTRAINT "batch_operations_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "production_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch_operations" ADD CONSTRAINT "batch_operations_operation_id_fkey" FOREIGN KEY ("operation_id") REFERENCES "product_operations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch_operations" ADD CONSTRAINT "batch_operations_workstation_id_fkey" FOREIGN KEY ("workstation_id") REFERENCES "workstations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch_operations" ADD CONSTRAINT "batch_operations_assigned_person_id_fkey" FOREIGN KEY ("assigned_person_id") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch_operation_logs" ADD CONSTRAINT "batch_operation_logs_batch_operation_id_fkey" FOREIGN KEY ("batch_operation_id") REFERENCES "batch_operations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch_operation_logs" ADD CONSTRAINT "batch_operation_logs_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;
