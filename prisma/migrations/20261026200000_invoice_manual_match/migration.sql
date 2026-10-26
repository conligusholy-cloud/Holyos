-- Ruční potvrzení objednávky / příjemky u faktury — kdo a kdy
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "manual_order_at" TIMESTAMP(3);
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "manual_order_by" VARCHAR(150);
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "manual_receipt_at" TIMESTAMP(3);
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "manual_receipt_by" VARCHAR(150);
