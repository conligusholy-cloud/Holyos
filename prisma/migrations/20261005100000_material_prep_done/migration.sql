-- Příprava materiálu pro pracoviště: stav „připraveno" (čtečka skladníka)
CREATE TABLE "material_prep_done" (
  "id" SERIAL NOT NULL,
  "kind" VARCHAR(20) NOT NULL,
  "batch_operation_id" INTEGER NOT NULL,
  "material_id" INTEGER,
  "qty" DECIMAL(12,3),
  "note" VARCHAR(500),
  "done_by_person_id" INTEGER,
  "done_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "material_prep_done_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "material_prep_done_kind_batch_operation_id_material_id_key" ON "material_prep_done"("kind", "batch_operation_id", "material_id");
CREATE INDEX "material_prep_done_batch_operation_id_idx" ON "material_prep_done"("batch_operation_id");
