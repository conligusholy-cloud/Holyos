-- Poptávky: příloha nabídky + AI kontrola + souhlas; nákupní objednávka: potvrzení dodavatelem přes odkaz
ALTER TABLE "purchase_inquiries" ADD COLUMN IF NOT EXISTS "offer_file_path" VARCHAR(500);
ALTER TABLE "purchase_inquiries" ADD COLUMN IF NOT EXISTS "offer_file_name" VARCHAR(255);
ALTER TABLE "purchase_inquiries" ADD COLUMN IF NOT EXISTS "offer_uploaded_at" TIMESTAMP(3);
ALTER TABLE "purchase_inquiries" ADD COLUMN IF NOT EXISTS "offer_check" JSONB;
ALTER TABLE "purchase_inquiries" ADD COLUMN IF NOT EXISTS "offer_checked_at" TIMESTAMP(3);
ALTER TABLE "purchase_inquiries" ADD COLUMN IF NOT EXISTS "accepted_at" TIMESTAMP(3);
ALTER TABLE "purchase_inquiries" ADD COLUMN IF NOT EXISTS "accepted_by" INTEGER;

ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "supplier_confirm_token" VARCHAR(64);
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "supplier_confirm_status" VARCHAR(20);
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "supplier_confirm_email" VARCHAR(255);
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "supplier_confirm_sent_at" TIMESTAMP(3);
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "supplier_confirmed_at" TIMESTAMP(3);
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "supplier_confirm_note" TEXT;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "supplier_confirm_name" VARCHAR(255);
CREATE UNIQUE INDEX IF NOT EXISTS "orders_supplier_confirm_token_key" ON "orders"("supplier_confirm_token");

ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "confirmed_price" DECIMAL(12,4);
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "supplier_note" TEXT;
