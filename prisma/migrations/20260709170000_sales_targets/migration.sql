-- Osobní prodejní cíle obchodníků (metric × period → cílová hodnota).
CREATE TABLE "sales_targets" (
  "id" SERIAL PRIMARY KEY,
  "person_id" INTEGER NOT NULL,
  "metric" VARCHAR(20) NOT NULL,
  "period" VARCHAR(10) NOT NULL,
  "value" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "sales_targets_person_id_metric_period_key" ON "sales_targets"("person_id", "metric", "period");
CREATE INDEX "sales_targets_person_id_idx" ON "sales_targets"("person_id");
