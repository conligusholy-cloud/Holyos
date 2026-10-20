-- Nákupní objednávka podle šablony: revize, potvrzený termín, podmínky, pole položek pro plánování a logistiku
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "revision" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "confirmed_delivery" DATE;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "po_data" JSONB;

ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "spec" TEXT;
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "confirmed_delivery" DATE;
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "vat_rate" DECIMAL(5,2);
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "delivery_place" VARCHAR(255);
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "production_ref" VARCHAR(100);
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "deliveries" JSONB;

CREATE INDEX IF NOT EXISTS "order_items_confirmed_delivery_idx" ON "order_items"("confirmed_delivery");
