-- Nářezové plány (CuttingPlan) — samostatná operace se vstupním materiálem a
-- více výstupními díly, jejichž provedení zaúčtuje skladové pohyby.

-- CreateTable
CREATE TABLE "cutting_plans" (
    "id" SERIAL NOT NULL,
    "code" VARCHAR(50),
    "name" VARCHAR(255) NOT NULL,
    "input_material_id" INTEGER NOT NULL,
    "input_quantity" DECIMAL(10,3) NOT NULL DEFAULT 1,
    "input_warehouse_id" INTEGER NOT NULL,
    "output_warehouse_id" INTEGER NOT NULL,
    "note" TEXT,
    "created_by" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cutting_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cutting_plan_outputs" (
    "id" SERIAL NOT NULL,
    "plan_id" INTEGER NOT NULL,
    "material_id" INTEGER NOT NULL,
    "quantity" DECIMAL(10,3) NOT NULL,
    "unit" VARCHAR(20) NOT NULL DEFAULT 'ks',

    CONSTRAINT "cutting_plan_outputs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cutting_plan_executions" (
    "id" SERIAL NOT NULL,
    "plan_id" INTEGER NOT NULL,
    "multiplier" DECIMAL(10,3) NOT NULL DEFAULT 1,
    "executed_by" INTEGER,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cutting_plan_executions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cutting_plans_code_key" ON "cutting_plans"("code");

-- CreateIndex
CREATE INDEX "cutting_plans_input_material_id_idx" ON "cutting_plans"("input_material_id");

-- CreateIndex
CREATE INDEX "cutting_plans_input_warehouse_id_idx" ON "cutting_plans"("input_warehouse_id");

-- CreateIndex
CREATE INDEX "cutting_plans_output_warehouse_id_idx" ON "cutting_plans"("output_warehouse_id");

-- CreateIndex
CREATE INDEX "cutting_plan_outputs_plan_id_idx" ON "cutting_plan_outputs"("plan_id");

-- CreateIndex
CREATE INDEX "cutting_plan_outputs_material_id_idx" ON "cutting_plan_outputs"("material_id");

-- CreateIndex
CREATE INDEX "cutting_plan_executions_plan_id_idx" ON "cutting_plan_executions"("plan_id");

-- AddForeignKey
ALTER TABLE "cutting_plans" ADD CONSTRAINT "cutting_plans_input_material_id_fkey" FOREIGN KEY ("input_material_id") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cutting_plans" ADD CONSTRAINT "cutting_plans_input_warehouse_id_fkey" FOREIGN KEY ("input_warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cutting_plans" ADD CONSTRAINT "cutting_plans_output_warehouse_id_fkey" FOREIGN KEY ("output_warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cutting_plans" ADD CONSTRAINT "cutting_plans_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cutting_plan_outputs" ADD CONSTRAINT "cutting_plan_outputs_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "cutting_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cutting_plan_outputs" ADD CONSTRAINT "cutting_plan_outputs_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cutting_plan_executions" ADD CONSTRAINT "cutting_plan_executions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "cutting_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cutting_plan_executions" ADD CONSTRAINT "cutting_plan_executions_executed_by_fkey" FOREIGN KEY ("executed_by") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;
