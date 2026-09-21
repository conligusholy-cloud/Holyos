-- Záznamník událostí objednávky (sledování celého procesu)
CREATE TABLE "order_events" (
  "id" SERIAL NOT NULL,
  "order_id" INTEGER NOT NULL,
  "ts" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "type" VARCHAR(40) NOT NULL,
  "label" VARCHAR(160) NOT NULL,
  "detail" TEXT,
  "actor" VARCHAR(120),
  CONSTRAINT "order_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "order_events_order_id_idx" ON "order_events"("order_id");
CREATE INDEX "order_events_type_idx" ON "order_events"("type");
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_order_id_fkey"
  FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
