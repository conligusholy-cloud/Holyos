-- DropIndex
DROP INDEX "materials_barcode_idx";

-- DropIndex
DROP INDEX "warehouse_locations_barcode_idx";

-- AlterTable
ALTER TABLE "inventory_movements" ADD COLUMN     "client_uuid" UUID,
ADD COLUMN     "device_id" VARCHAR(100),
ADD COLUMN     "document_id" INTEGER,
ADD COLUMN     "from_location_id" INTEGER,
ADD COLUMN     "to_location_id" INTEGER;

-- AlterTable
ALTER TABLE "materials" ADD COLUMN     "sector" VARCHAR(20);

-- AlterTable
ALTER TABLE "warehouse_locations" ADD COLUMN     "locked_for_inventory" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "type" VARCHAR(30) NOT NULL DEFAULT 'position';

-- CreateTable
CREATE TABLE "stock" (
    "id" SERIAL NOT NULL,
    "material_id" INTEGER NOT NULL,
    "location_id" INTEGER NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "reserved_quantity" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warehouse_documents" (
    "id" SERIAL NOT NULL,
    "type" VARCHAR(30) NOT NULL,
    "number" VARCHAR(50) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'draft',
    "partner_id" INTEGER,
    "reference" VARCHAR(255),
    "note" TEXT,
    "created_by" INTEGER,
    "completed_at" TIMESTAMP(3),
    "completed_by" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "warehouse_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "batches" (
    "id" SERIAL NOT NULL,
    "number" VARCHAR(50) NOT NULL,
    "sector" VARCHAR(20),
    "status" VARCHAR(20) NOT NULL DEFAULT 'open',
    "assigned_to" INTEGER,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "batch_items" (
    "id" SERIAL NOT NULL,
    "batch_id" INTEGER NOT NULL,
    "material_id" INTEGER NOT NULL,
    "from_location_id" INTEGER,
    "quantity" DECIMAL(12,3) NOT NULL,
    "picked_quantity" DECIMAL(12,3),
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "picked_by" INTEGER,
    "picked_at" TIMESTAMP(3),
    "note" TEXT,

    CONSTRAINT "batch_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "printers" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "model" VARCHAR(50) NOT NULL DEFAULT 'TSC_TC200',
    "location_id" INTEGER,
    "connection_type" VARCHAR(10) NOT NULL DEFAULT 'lan',
    "ip_address" INET,
    "port" INTEGER,
    "language" VARCHAR(10) NOT NULL DEFAULT 'ZPL',
    "label_width_mm" DECIMAL(6,2) NOT NULL DEFAULT 60,
    "label_height_mm" DECIMAL(6,2) NOT NULL DEFAULT 20,
    "dpi" INTEGER NOT NULL DEFAULT 203,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_ping_ok" TIMESTAMP(3),
    "encoding" VARCHAR(20) NOT NULL DEFAULT 'UTF-8',
    "pre_command" TEXT,
    "post_command" TEXT,
    "gap_mm" DECIMAL(4,2),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "printers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "label_templates" (
    "id" SERIAL NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "language" VARCHAR(10) NOT NULL DEFAULT 'ZPL',
    "width_mm" DECIMAL(6,2) NOT NULL DEFAULT 60,
    "height_mm" DECIMAL(6,2) NOT NULL DEFAULT 20,
    "body" TEXT NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "label_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "print_jobs" (
    "id" SERIAL NOT NULL,
    "template_id" INTEGER,
    "printer_id" INTEGER NOT NULL,
    "data" JSONB NOT NULL,
    "copies" INTEGER NOT NULL DEFAULT 1,
    "status" VARCHAR(20) NOT NULL DEFAULT 'queued',
    "error" TEXT,
    "requested_by" INTEGER,
    "device_id" VARCHAR(100),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "print_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stock_location_id_idx" ON "stock"("location_id");

-- CreateIndex
CREATE INDEX "stock_material_id_idx" ON "stock"("material_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_material_id_location_id_key" ON "stock"("material_id", "location_id");

-- CreateIndex
CREATE UNIQUE INDEX "warehouse_documents_number_key" ON "warehouse_documents"("number");

-- CreateIndex
CREATE INDEX "warehouse_documents_type_idx" ON "warehouse_documents"("type");

-- CreateIndex
CREATE INDEX "warehouse_documents_status_idx" ON "warehouse_documents"("status");

-- CreateIndex
CREATE INDEX "warehouse_documents_partner_id_idx" ON "warehouse_documents"("partner_id");

-- CreateIndex
CREATE INDEX "warehouse_documents_created_at_idx" ON "warehouse_documents"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "batches_number_key" ON "batches"("number");

-- CreateIndex
CREATE INDEX "batches_status_idx" ON "batches"("status");

-- CreateIndex
CREATE INDEX "batches_assigned_to_idx" ON "batches"("assigned_to");

-- CreateIndex
CREATE INDEX "batches_sector_idx" ON "batches"("sector");

-- CreateIndex
CREATE INDEX "batch_items_batch_id_idx" ON "batch_items"("batch_id");

-- CreateIndex
CREATE INDEX "batch_items_material_id_idx" ON "batch_items"("material_id");

-- CreateIndex
CREATE INDEX "batch_items_status_idx" ON "batch_items"("status");

-- CreateIndex
CREATE INDEX "printers_location_id_idx" ON "printers"("location_id");

-- CreateIndex
CREATE INDEX "printers_is_active_idx" ON "printers"("is_active");

-- CreateIndex
CREATE UNIQUE INDEX "label_templates_code_key" ON "label_templates"("code");

-- CreateIndex
CREATE INDEX "print_jobs_printer_id_idx" ON "print_jobs"("printer_id");

-- CreateIndex
CREATE INDEX "print_jobs_status_idx" ON "print_jobs"("status");

-- CreateIndex
CREATE INDEX "print_jobs_created_at_idx" ON "print_jobs"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_movements_client_uuid_key" ON "inventory_movements"("client_uuid");

-- CreateIndex
CREATE INDEX "inventory_movements_document_id_idx" ON "inventory_movements"("document_id");

-- CreateIndex
CREATE INDEX "inventory_movements_from_location_id_idx" ON "inventory_movements"("from_location_id");

-- CreateIndex
CREATE INDEX "inventory_movements_to_location_id_idx" ON "inventory_movements"("to_location_id");

-- CreateIndex
CREATE UNIQUE INDEX "materials_barcode_key" ON "materials"("barcode");

-- CreateIndex
CREATE INDEX "materials_sector_idx" ON "materials"("sector");

-- CreateIndex
CREATE UNIQUE INDEX "warehouse_locations_barcode_key" ON "warehouse_locations"("barcode");

-- CreateIndex
CREATE INDEX "warehouse_locations_type_idx" ON "warehouse_locations"("type");

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_from_location_id_fkey" FOREIGN KEY ("from_location_id") REFERENCES "warehouse_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_to_location_id_fkey" FOREIGN KEY ("to_location_id") REFERENCES "warehouse_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "warehouse_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock" ADD CONSTRAINT "stock_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock" ADD CONSTRAINT "stock_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "warehouse_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_documents" ADD CONSTRAINT "warehouse_documents_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_documents" ADD CONSTRAINT "warehouse_documents_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batches" ADD CONSTRAINT "batches_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch_items" ADD CONSTRAINT "batch_items_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch_items" ADD CONSTRAINT "batch_items_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch_items" ADD CONSTRAINT "batch_items_from_location_id_fkey" FOREIGN KEY ("from_location_id") REFERENCES "warehouse_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch_items" ADD CONSTRAINT "batch_items_picked_by_fkey" FOREIGN KEY ("picked_by") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "printers" ADD CONSTRAINT "printers_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "warehouse_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "print_jobs" ADD CONSTRAINT "print_jobs_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "label_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "print_jobs" ADD CONSTRAINT "print_jobs_printer_id_fkey" FOREIGN KEY ("printer_id") REFERENCES "printers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "print_jobs" ADD CONSTRAINT "print_jobs_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;

