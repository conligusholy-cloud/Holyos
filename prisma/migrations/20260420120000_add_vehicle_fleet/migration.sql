-- =============================================================================
-- HolyOS — Migrace: Vozový park (Vehicle Fleet)
-- =============================================================================

-- CreateTable
CREATE TABLE "vehicles" (
    "id" SERIAL NOT NULL,
    "license_plate" VARCHAR(20),
    "model" VARCHAR(255) NOT NULL,
    "vin" VARCHAR(30),
    "category" VARCHAR(50) NOT NULL,
    "color" VARCHAR(50),
    "year" INTEGER,
    "insurance_from" DATE,
    "insurance_to" DATE,
    "insurance_company" VARCHAR(255),
    "stk_valid_to" DATE,
    "toll_sticker_to" DATE,
    "financing_type" VARCHAR(50),
    "financing_to" DATE,
    "financing_owner" VARCHAR(255),
    "disk_size" VARCHAR(255),
    "tire_size" VARCHAR(255),
    "driver_id" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "current_km" INTEGER,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "vehicles_license_plate_idx" ON "vehicles"("license_plate");
CREATE INDEX "vehicles_vin_idx" ON "vehicles"("vin");
CREATE INDEX "vehicles_category_idx" ON "vehicles"("category");
CREATE INDEX "vehicles_driver_id_idx" ON "vehicles"("driver_id");
CREATE INDEX "vehicles_active_idx" ON "vehicles"("active");
CREATE INDEX "vehicles_insurance_to_idx" ON "vehicles"("insurance_to");
CREATE INDEX "vehicles_stk_valid_to_idx" ON "vehicles"("stk_valid_to");
CREATE INDEX "vehicles_toll_sticker_to_idx" ON "vehicles"("toll_sticker_to");

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;
